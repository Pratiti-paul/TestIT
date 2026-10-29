import { chromium } from 'playwright';
import { validateUrl } from '../utils/urlValidator.js';
import { resolveLocator } from './functionalTestRunner.js';
import { verifyAuthenticationSuccess } from './verifiers/authVerifier.js';
import { discoverWebsite, navigateToDiscoveredCapability } from './websiteDiscoveryService.js';

const MAX_CONCURRENT_TESTS = parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 3;
let activeTests = 0;

/**
 * Generic inspection of the active page to determine page type and available controls.
 * Uses common web conventions and heuristics without hardcoding target-specific selectors.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object>} Page structure analysis
 */
export async function inspectPageType(page) {
  let pathname = '';
  try {
    pathname = new URL(page.url()).pathname.toLowerCase();
  } catch {
    pathname = '';
  }

  const analysis = await page
    .evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) =>
        (h.textContent || '').trim().toLowerCase()
      );

      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).map((i) => ({
        type: (i.getAttribute('type') || 'text').toLowerCase(),
        name: (i.getAttribute('name') || '').toLowerCase(),
        placeholder: (i.getAttribute('placeholder') || '').toLowerCase(),
        id: (i.getAttribute('id') || '').toLowerCase(),
        ariaLabel: (i.getAttribute('aria-label') || '').toLowerCase(),
      }));

      const buttons = Array.from(
        document.querySelectorAll('button, input[type="submit"], [role="button"]')
      ).map((b) => (b.textContent || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase());

      const links = Array.from(document.querySelectorAll('a, [role="link"]')).map((a) => ({
        text: (a.textContent || '').trim().toLowerCase(),
        href: (a.getAttribute('href') || '').toLowerCase(),
      }));

      return { headings, inputs, buttons, links };
    })
    .catch(() => ({ headings: [], inputs: [], buttons: [], links: [] }));

  // URL path checks with word boundaries / segment matching
  const isSignupPath = /(?:^|\/)(signup|sign-up|register|join|create-account)/i.test(pathname);
  const isLoginPath = /(?:^|\/)(login|signin|sign-in)/i.test(pathname) && !isSignupPath;

  const hasSignupHeading = analysis.headings.some(
    (h) =>
      h.includes('sign up') ||
      h.includes('signup') ||
      h.includes('register') ||
      h.includes('create account') ||
      h.includes('create an account') ||
      h.includes('join')
  );

  const hasSignupButton = analysis.buttons.some(
    (b) =>
      b.includes('sign up') ||
      b.includes('signup') ||
      b.includes('register') ||
      b.includes('create account')
  );

  const hasConfirmPassword = analysis.inputs.some(
    (i) => i.name.includes('confirm') || i.placeholder.includes('confirm') || i.id.includes('confirm')
  );

  const hasNameInput = analysis.inputs.some(
    (i) =>
      i.name === 'name' ||
      i.name.includes('fullname') ||
      i.name.includes('username') ||
      i.placeholder.includes('name')
  );

  const isSignupPage =
    isSignupPath ||
    hasSignupHeading ||
    hasSignupButton ||
    (hasConfirmPassword && hasNameInput);

  // Check for login indicators
  const hasLoginHeading = analysis.headings.some(
    (h) =>
      h.includes('log in') ||
      h.includes('login') ||
      h.includes('sign in') ||
      h.includes('signin') ||
      h.includes('welcome back') ||
      h.includes('account login')
  );

  const hasLoginButton = analysis.buttons.some(
    (b) => b === 'log in' || b === 'login' || b === 'sign in' || b === 'signin'
  );

  const hasPasswordField = analysis.inputs.some((i) => i.type === 'password');
  const hasEmailOrUsername = analysis.inputs.some(
    (i) =>
      i.type === 'email' ||
      i.name.includes('email') ||
      i.name.includes('username') ||
      i.placeholder.includes('email') ||
      i.placeholder.includes('username') ||
      i.ariaLabel.includes('email') ||
      i.ariaLabel.includes('username')
  );

  const hasLoginFormControls =
    hasPasswordField && hasEmailOrUsername && !hasConfirmPassword && !hasNameInput;

  const isLoginPage =
    !isSignupPage &&
    (isLoginPath || hasLoginHeading || (hasLoginButton && hasLoginFormControls));

  return {
    pathname,
    isSignupPage,
    isLoginPage,
    hasLoginFormControls,
    headings: analysis.headings,
    links: analysis.links,
  };
}

/**
 * Ensures the browser is positioned on a real login page before attempting login interactions.
 * If currently on a signup or home page, discovers and navigates via available login links.
 * Halts with BLOCKED if no login page can be identified or reached.
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} timeout
 * @returns {Promise<{ expected: string, actual: string }>}
 */
export async function ensureLoginPage(page, step, timeout, discoveryResult = null) {
  const currentUrl = page.url();
  const info = await inspectPageType(page);

  // 1. If already on a confirmed login page with controls
  if (info.isLoginPage && info.hasLoginFormControls) {
    return {
      expected: step.expected || 'Confirm active page is the login page',
      actual: `Verified current page is Login Page (${currentUrl}) with login controls`,
    };
  }

  // 2. Check if website discovery located a dedicated login page
  if (discoveryResult?.loginPageUrl && discoveryResult.loginPageUrl !== currentUrl) {
    try {
      await page.goto(discoveryResult.loginPageUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 5000) });
      await page.waitForTimeout(400);
      const postInfo = await inspectPageType(page);
      if (postInfo.isLoginPage || postInfo.hasLoginFormControls) {
        return {
          expected: step.expected || 'Navigate to login page',
          actual: `Navigated to discovered login interface (${page.url()})`,
        };
      }
    } catch {
      // Continue to in-page link discovery
    }
  }

  // 3. Discover login navigation link / button
  const loginLinkSelectors = [
    'a:has-text("Already have an account")',
    'a:has-text("Log in")',
    'a:has-text("Login")',
    'a:has-text("Sign in")',
    'a[href*="login" i]',
    'a[href*="signin" i]',
    'a[href*="sign-in" i]',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'nav a:has-text("Login")',
    'header a:has-text("Login")',
  ];

  let clickedLink = null;
  for (const selector of loginLinkSelectors) {
    const loc = page.locator(selector).first();
    const isVisible = await loc.isVisible({ timeout: 400 }).catch(() => false);
    if (isVisible) {
      clickedLink = loc;
      break;
    }
  }

  if (clickedLink) {
    const prevUrl = page.url();
    await clickedLink.click({ timeout: Math.min(timeout, 4000) });
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 5000) }).catch(() => {});
    await page.waitForTimeout(500);

    const postUrl = page.url();
    const postInfo = await inspectPageType(page);

    if (postInfo.isLoginPage || postInfo.hasLoginFormControls) {
      return {
        expected: step.expected || 'Navigate from registration/home page to login page',
        actual: `Discovered login navigation link and transitioned from ${prevUrl} to Login page (${postUrl})`,
      };
    }

    const err = new Error(
      `Discovered and clicked login link, but arrived on page (${postUrl}) that does not present login controls.`
    );
    err.statusType = 'BLOCKED';
    throw err;
  }

  // 3. No login link could be found
  const reason = info.isSignupPage
    ? `Target URL landed on a registration/signup page (${currentUrl}), and no login navigation link ("Already have an account? Login", etc.) was discovered.`
    : `Target URL (${currentUrl}) is not a login page and does not present login controls or a visible login navigation link.`;

  const err = new Error(`Prerequisite verification blocked: ${reason}`);
  err.statusType = 'BLOCKED';
  throw err;
}

/**
 * Verifies the application's response to invalid login credentials:
 * - Checks for an observable error message or alert, OR
 * - Verifies user remains unauthenticated on the login page (not redirected to authenticated area).
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} timeout
 * @returns {Promise<{ expected: string, actual: string }>}
 */
export async function assertInvalidLogin(page, step, timeout) {
  // Settle time for network and DOM update
  await page.waitForTimeout(1000);

  const currentUrl = page.url();

  // 1. Search for observable error messages / alerts
  const errorSelectors = [
    '[role="alert"]',
    '.error',
    '.alert',
    '.notification-danger',
    '.toast-error',
    'p:has-text("Invalid")',
    'p:has-text("incorrect")',
    'span:has-text("Invalid")',
    'span:has-text("incorrect")',
    'div:has-text("Invalid credentials")',
    'div:has-text("User not found")',
    'div:has-text("Wrong password")',
  ];

  let observedErrorText = null;
  for (const selector of errorSelectors) {
    const loc = page.locator(selector).first();
    const visible = await loc.isVisible({ timeout: 200 }).catch(() => false);
    if (visible) {
      const text = (await loc.textContent().catch(() => '')) || '';
      if (text.trim()) {
        observedErrorText = text.trim();
        break;
      }
    }
  }

  // 2. Check if user was incorrectly granted access
  const isRedirectedToAuth =
    currentUrl.includes('/dashboard') ||
    currentUrl.includes('/account') ||
    currentUrl.includes('/home') ||
    currentUrl.includes('/profile');

  if (isRedirectedToAuth) {
    const err = new Error(
      `Security assertion failed: Application accepted invalid credentials and redirected to authenticated area (${currentUrl}).`
    );
    err.statusType = 'FAIL';
    throw err;
  }

  // 3. Evaluate results
  if (observedErrorText) {
    return {
      expected:
        step.expected ||
        'Observable authentication error displayed or user remains unauthenticated on login page',
      actual: `Observable authentication error displayed: "${observedErrorText}"`,
    };
  }

  // If requireErrorMessage is explicitly set and no message appeared
  if (step.requireErrorMessage === true) {
    const err = new Error(
      'Observable authentication error message was not displayed after submitting invalid credentials.'
    );
    err.statusType = 'FAIL';
    throw err;
  }

  // Check that user is still on login page and controls remain
  const info = await inspectPageType(page);
  if (info.isLoginPage || info.hasLoginFormControls) {
    return {
      expected:
        step.expected ||
        'Observable authentication error displayed or user remains unauthenticated on login page',
      actual: `User remained unauthenticated on the login page (${currentUrl}); access was rejected without redirecting to authenticated area`,
    };
  }

  const err = new Error(
    `Invalid credentials submission did not show an error message and left the login page to "${currentUrl}".`
  );
  err.statusType = 'FAIL';
  throw err;
}

/**
 * Ensures the browser has navigated to an interface containing an active search field.
 * If search is already available on the page, passes immediately.
 * If on an unauthenticated login page and search requires login, halts with BLOCKED.
 * If on a general landing/home page, discovers and follows catalog/products navigation links.
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} timeout
 * @returns {Promise<{ expected: string, actual: string }>}
 */
export async function ensureSearchPage(page, step, timeout, discoveryResult = null) {
  const currentUrl = page.url();

  // 1. Check if search input is already visible and enabled on current page
  const searchInputSelectors = [
    'input[type="search"]',
    'input[placeholder*="search" i]',
    '[role="searchbox"]',
    'input[name="search" i]',
    'input[name="q" i]',
    '[data-testid*="search" i]',
    'input[class*="search" i]',
    'input[id*="search" i]',
  ];

  for (const sel of searchInputSelectors) {
    const loc = page.locator(sel).first();
    const isVis = await loc.isVisible({ timeout: 400 }).catch(() => false);
    if (isVis) {
      return {
        expected: step.expected || 'Ensure active page provides a search field',
        actual: `Current page (${currentUrl}) already provides an active search field`,
      };
    }
  }

  // 2. Check if website discovery already located a search or catalog page
  const targetUrl = discoveryResult?.searchPageUrl || discoveryResult?.catalogPageUrl;
  if (targetUrl && targetUrl !== currentUrl) {
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(timeout, 5000),
      });
      await page.waitForTimeout(400);

      for (const sel of searchInputSelectors) {
        const loc = page.locator(sel).first();
        const isVis = await loc.isVisible({ timeout: 1500 }).catch(() => false);
        if (isVis) {
          return {
            expected: step.expected || 'Navigate to search interface',
            actual: `Navigated to discovered search interface (${page.url()})`,
          };
        }
      }
    } catch {
      // Continue to in-page link discovery
    }
  }

  // 2. If on login page (e.g. from prior login test step), attempt navigating back to startUrl/homepage
  const info = await inspectPageType(page);
  if (info.isLoginPage) {
    const fallbackTarget = step.startUrl;
    if (fallbackTarget && fallbackTarget !== currentUrl) {
      try {
        await page.goto(fallbackTarget, { timeout: Math.min(timeout, 5000), waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
      } catch {
        // Fallback to in-page logo/home link
        const logoLink = page.locator('a[href="/"], a[aria-label*="home" i], a[aria-label*="logo" i], a.navbar-brand, a.logo, a:has-text("Home"), header a:first-of-type').first();
        if (await logoLink.isVisible({ timeout: 500 }).catch(() => false)) {
          await logoLink.click().catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    } else {
      const logoLink = page.locator('a[href="/"], a[aria-label*="home" i], a[aria-label*="logo" i], a.navbar-brand, a.logo, a:has-text("Home"), header a:first-of-type').first();
      if (await logoLink.isVisible({ timeout: 500 }).catch(() => false)) {
        await logoLink.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // Check if landing page directly provides a search input
    for (const sel of searchInputSelectors) {
      const loc = page.locator(sel).first();
      const isVis = await loc.isVisible({ timeout: 600 }).catch(() => false);
      if (isVis) {
        return {
          expected: step.expected || 'Ensure active page provides a search field',
          actual: `Returned from login to public page (${page.url()}) which provides an active search field`,
        };
      }
    }

    // If still stuck on login after navigation attempt, then search truly requires authentication
    const postNavInfo = await inspectPageType(page);
    if (postNavInfo.isLoginPage) {
      const err = new Error(
        `Unable to locate search field: Browser is currently on the unauthenticated Login page (${page.url()}). The website requires authentication to reach the product catalog. Please supply valid test credentials to test authenticated features.`
      );
      err.statusType = 'BLOCKED';
      throw err;
    }
  }

  // 3. Search not present on current page: discover catalog navigation links
  // Check candidate selectors supplied in step target / fallbacks first
  const stepCandidates = [];
  if (step?.target?.value) {
    if (step.target.strategy === 'css') stepCandidates.push(step.target.value);
    else if (step.target.strategy === 'role' && step.target.name) stepCandidates.push(`a:has-text("${step.target.name}"), button:has-text("${step.target.name}")`);
  }
  if (Array.isArray(step?.fallbacks)) {
    for (const fb of step.fallbacks) {
      if (fb.strategy === 'css' && fb.value) stepCandidates.push(fb.value);
      else if (fb.strategy === 'role' && fb.name) stepCandidates.push(`a:has-text("${fb.name}"), button:has-text("${fb.name}")`);
    }
  }

  const catalogNavSelectors = [
    ...stepCandidates,
    'a:has-text("Products")',
    'a:has-text("Shop")',
    'a:has-text("Catalog")',
    'a:has-text("Store")',
    'a:has-text("Items")',
    'a:has-text("Browse")',
    'a:has-text("Collection")',
    'a:has-text("Inventory")',
    'a:has-text("Categories")',
    'a:has-text("Menu")',
    'a:has-text("Search")',
    'a[href*="product" i]',
    'a[href*="catalog" i]',
    'a[href*="shop" i]',
    'a[href*="store" i]',
    'a[href*="item" i]',
    'a[href*="browse" i]',
    'a[href*="collection" i]',
    'button:has-text("Products")',
    'button:has-text("Shop")',
    'button:has-text("Catalog")',
    'button:has-text("Browse")',
  ];

  let clickedNav = null;
  for (const sel of catalogNavSelectors) {
    const loc = page.locator(sel).first();
    const isVis = await loc.isVisible({ timeout: 300 }).catch(() => false);
    if (isVis) {
      clickedNav = loc;
      break;
    }
  }

  // If no predefined catalog link matched, dynamically inspect visible navigation links
  if (!clickedNav) {
    const navLinks = await page.locator('nav a[href], header a[href], [role="navigation"] a[href]').all().catch(() => []);
    for (const link of navLinks) {
      const isVis = await link.isVisible().catch(() => false);
      if (!isVis) continue;
      const href = (await link.getAttribute('href').catch(() => '')) || '';
      const text = (await link.innerText().catch(() => '')).trim().toLowerCase();

      const isNonCatalog =
        href === '/' ||
        href === currentUrl ||
        text === 'home' ||
        text.includes('login') ||
        text.includes('sign in') ||
        text.includes('signup') ||
        text.includes('register') ||
        text.includes('cart') ||
        text === '🛒' ||
        text.includes('about') ||
        text.includes('contact') ||
        text.includes('privacy') ||
        text.includes('terms') ||
        text.includes('faq');

      if (!isNonCatalog && (text.length > 0 || href.length > 1)) {
        clickedNav = link;
        break;
      }
    }
  }

  if (clickedNav) {
    const prevUrl = page.url();
    await clickedNav.click({ timeout: Math.min(timeout, 4000) });
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 5000) }).catch(() => {});
    await page.waitForTimeout(600);

    // Verify search input is now present on the navigated page
    for (const sel of searchInputSelectors) {
      const loc = page.locator(sel).first();
      const isVis = await loc.isVisible({ timeout: 2000 }).catch(() => false);
      if (isVis) {
        return {
          expected: step.expected || 'Navigate to catalog or search interface',
          actual: `Discovered catalog navigation link and navigated from ${prevUrl} to search page (${page.url()})`,
        };
      }
    }

    const postUrl = page.url();
    const postInfo = await inspectPageType(page);
    if (postInfo.isLoginPage) {
      const err = new Error(
        `Navigation to catalog from ${prevUrl} redirected to Login page (${postUrl}) because the catalog requires an authenticated session. Please supply valid test credentials.`
      );
      err.statusType = 'BLOCKED';
      throw err;
    }
  }

  // If we could not find catalog link or search field
  const err = new Error(
    `Unable to locate search field or catalog navigation link on ${currentUrl}. The page does not present a visible search input or recognizable catalog link.`
  );
  err.statusType = 'BLOCKED';
  throw err;
}

/**
 * Attempts to resolve an element using the primary target and any fallback strategies.
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} timeout
 * @returns {Promise<import('playwright').Locator>}
 */
async function smartFindElement(page, step, timeout) {
  const primaryTarget = step.target;
  const fallbacks = Array.isArray(step.fallbacks) ? step.fallbacks : [];
  const candidates = [primaryTarget, ...fallbacks].filter(Boolean);

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const rawLocator = resolveLocator(page, candidate);
      const locator = rawLocator.first();
      // Give each candidate a portion of the step timeout (minimum 1200ms)
      const candTimeout = Math.max(1200, Math.floor(timeout / candidates.length));
      await locator.waitFor({ state: 'visible', timeout: candTimeout });
      return locator;
    } catch (err) {
      lastError = err;
    }
  }

  const tried = candidates.map((c) => `${c.strategy}="${c.value || c.name || ''}"`).join(', ');
  const err = new Error(
    `Unable to locate accessible control for "${step.description || step.action}". Tried: [${tried}]. The page structure may require clarification or the element is not currently visible.`
  );
  err.statusType = 'BLOCKED';
  throw err;
}

/**
 * Executes a single AI test step with smart locator fallbacks and functional verification.
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} defaultTimeoutMs
 * @returns {Promise<{ expected: string, actual: string, screenshot?: string }>}
 */
async function executeAiStep(page, step, defaultTimeoutMs, discoveryResult = null, startUrl = '') {
  const timeout = step.timeoutMs || defaultTimeoutMs;

  switch (step.action) {
    case 'navigate': {
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout });
      const currentUrl = page.url();
      return {
        expected: step.expected || `Navigate to "${step.url}"`,
        actual: `Successfully landed on "${currentUrl}"`,
      };
    }

    case 'resetAuthSession': {
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
      }).catch(() => {});
      const inputs = page.locator('input[type="text"], input[type="email"], input[type="password"]');
      const count = await inputs.count().catch(() => 0);
      for (let k = 0; k < count; k++) {
        await inputs.nth(k).fill('').catch(() => {});
      }
      await page.waitForTimeout(300);
      return {
        expected: step.expected || 'Establish fresh session for authentication',
        actual: 'Session storage cleared and form reset for fresh authentication attempt',
      };
    }

    case 'ensureLoginPage': {
      return await ensureLoginPage(page, step, timeout, discoveryResult);
    }

    case 'ensureSearchPage': {
      return await ensureSearchPage(page, step, timeout, discoveryResult);
    }

    case 'assertInvalidLogin': {
      return await assertInvalidLogin(page, step, timeout);
    }

    case 'assertAuthenticatedState': {
      const outcome = await verifyAuthenticationSuccess(page, {
        submittedUsername: step.submittedUsername,
        preLoginUrl: step.preLoginUrl || step.startUrl || startUrl,
        timeout,
      });

      if (!outcome.pass) {
        const err = new Error(outcome.actual);
        err.statusType = outcome.status || 'FAIL';
        err.signals = outcome.signals;
        throw err;
      }

      return {
        expected: step.expected || outcome.expected,
        actual: outcome.actual,
      };
    }

    case 'click': {
      const locator = await smartFindElement(page, step, timeout);
      const prevUrl = page.url();

      const isEnabled = await locator.isEnabled({ timeout: Math.min(timeout, 2000) }).catch(() => true);
      if (!isEnabled) {
        const err = new Error(`Target button/control is disabled and cannot be clicked.`);
        err.statusType = 'BLOCKED';
        throw err;
      }

      await locator.click({ timeout });
      await page.waitForTimeout(400);

      const postUrl = page.url();
      const urlChanged = postUrl !== prevUrl;

      // Functional effect verification if specified
      if (step.verifyEffect === 'urlChange' && !urlChanged) {
        const err = new Error(
          `Click completed but expected functional effect did not occur (URL remained "${prevUrl}").`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      if (step.expectedUrl && !postUrl.includes(step.expectedUrl)) {
        const err = new Error(
          `Click completed but expected URL "${step.expectedUrl}" was not reached (current: "${postUrl}").`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      let actual = 'Click dispatched successfully on enabled element';
      if (urlChanged) {
        actual = `Click dispatched; navigated from "${prevUrl}" to "${postUrl}"`;
      }

      return {
        expected: step.expected || `Click element: ${step.description}`,
        actual,
      };
    }

    case 'fill': {
      const locator = await smartFindElement(page, step, timeout);
      await locator.fill(String(step.value), { timeout });

      // If filling a search query or marked as isSearch, trigger search submit via Enter
      if (step.isSearch === true) {
        await locator.press('Enter').catch(() => {});
        await page.waitForTimeout(400);
      }

      const displayVal = step.isSensitive ? '••••••••' : String(step.value);
      return {
        expected: step.expected || `Fill input with "${displayVal}"`,
        actual: `Input filled with "${displayVal}"${step.isSearch ? ' and search submitted' : ''}`,
      };
    }

    case 'select': {
      const locator = await smartFindElement(page, step, timeout);
      await locator.selectOption(String(step.value), { timeout });
      return {
        expected: step.expected || `Select option "${step.value}"`,
        actual: `Option "${step.value}" selected`,
      };
    }

    case 'assertVisible': {
      await smartFindElement(page, step, timeout);
      return {
        expected: step.expected || `Element is visible: ${step.description}`,
        actual: 'Element is visible on page as expected',
      };
    }

    case 'assertText': {
      const locator = await smartFindElement(page, step, timeout);
      const text = (await locator.textContent({ timeout })) || '';
      const expectedText = String(step.value);

      const matched = step.exact
        ? text.trim() === expectedText.trim()
        : text.toLowerCase().includes(expectedText.toLowerCase());

      if (!matched) {
        const err = new Error(
          `Text verification failed. Expected "${expectedText}", but observed "${text.trim()}".`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      return {
        expected: step.expected || `Element contains text "${expectedText}"`,
        actual: `Observed text: "${text.trim()}"`,
      };
    }

    case 'assertUrl': {
      const currentUrl = page.url();
      const expected = String(step.value);
      const matched = step.exact
        ? currentUrl === expected
        : currentUrl.toLowerCase().includes(expected.toLowerCase());

      if (!matched) {
        const err = new Error(
          `URL verification failed. Expected URL to include "${expected}", but current URL is "${currentUrl}".`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      return {
        expected: step.expected || `URL matches "${expected}"`,
        actual: `Current URL is "${currentUrl}"`,
      };
    }

    case 'assertCount': {
      const locator = resolveLocator(page, step.target);
      const count = await locator.count();
      const expectedCount = Number(step.value);

      if (count !== expectedCount) {
        const err = new Error(
          `Count assertion failed. Expected ${expectedCount} elements, but found ${count}.`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      return {
        expected: step.expected || `Found ${expectedCount} elements`,
        actual: `Observed ${count} elements`,
      };
    }

    case 'assertDateSync': {
      const today = new Date();
      const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const currentDayShort = daysShort[today.getDay()];
      const currentDayFull = daysFull[today.getDay()];
      const currentDateNum = today.getDate();
      const currentMonthShort = today.toLocaleString('en-US', { month: 'short' });
      const currentYear = today.getFullYear();

      // Look for active day / date selectors across standard UI patterns
      const activeSelectors = [
        'button.bg-primary',
        'button[aria-selected="true"]',
        'button.active',
        '[aria-current="date"]',
        '.active-day',
        '[class*="active"][class*="day"]',
        '[class*="selected"][class*="day"]',
      ];

      let identifiedDay = null;
      let syncPassed = false;
      let matchedSource = '';

      for (const selector of activeSelectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            const el = locator.nth(i);
            const text = ((await el.innerText().catch(() => '')) || '').trim();
            const firstLine = text.split('\n')[0].trim();
            if (firstLine) {
              for (const day of [currentDayShort, currentDayFull]) {
                if (firstLine.toLowerCase().includes(day.toLowerCase())) {
                  identifiedDay = firstLine;
                  syncPassed = true;
                  matchedSource = `active control ("${selector}") displaying "${firstLine}"`;
                  break;
                }
              }
              if (syncPassed) break;
              if (!identifiedDay) identifiedDay = firstLine;
            }
          }
          if (syncPassed) break;
        }
      }

      // If not found in active button styling, scan page text for today's day/date
      if (!syncPassed) {
        const bodyText = await page.innerText('body').catch(() => '');
        const hasTodayText = bodyText.includes('Today');
        const hasCurrentDay =
          bodyText.toLowerCase().includes(currentDayShort.toLowerCase()) ||
          bodyText.toLowerCase().includes(currentDayFull.toLowerCase());

        if (hasTodayText && hasCurrentDay) {
          syncPassed = true;
          identifiedDay = `Today (${currentDayShort})`;
          matchedSource = `page content containing "Today" and current day "${currentDayShort}"`;
        } else if (hasCurrentDay) {
          syncPassed = true;
          identifiedDay = currentDayShort;
          matchedSource = `page schedule containing current day "${currentDayShort}"`;
        }
      }

      if (!syncPassed) {
        const err = new Error(
          `Date synchronization failed: Expected page to highlight or display current day "${currentDayFull}" (${currentDayShort}, ${currentMonthShort} ${currentDateNum}), but found "${identifiedDay || 'no active day indicator'}".`
        );
        err.statusType = 'FAIL';
        throw err;
      }

      return {
        expected:
          step.expected ||
          `Page active day/date is synchronized with current day (${currentDayFull} / ${currentDayShort})`,
        actual: `Identified ${matchedSource}, correctly synchronized with system date (${currentDayFull}, ${currentMonthShort} ${currentDateNum}, ${currentYear})`,
      };
    }

    case 'screenshot': {
      const buffer = await page.screenshot({ type: 'png', timeout });
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
      return {
        expected: step.expected || 'Capture evidence screenshot of verified page state',
        actual: 'Screenshot captured',
        screenshot: base64,
      };
    }

    default:
      throw new Error(`Unsupported action "${step.action}"`);
  }
}

/**
 * Runs an AI-planned test journey in a controlled Playwright environment.
 *
 * @param {object} plan - Planned test from aiPlannerService
 * @param {string} startUrl - Target URL
 * @param {object} [options]
 * @param {boolean} [options.allowLocalForTesting]
 * @returns {Promise<object>} Complete execution report
 */
export async function runAiTest(plan, startUrl, options = {}) {
  // Handle blocked or unsupported plans
  if (plan.status === 'blocked' || plan.status === 'unsupported') {
    return {
      testName: plan.objective || 'AI Website Test',
      startUrl,
      finalUrl: startUrl,
      status: plan.status,
      blockedReason: plan.blockedReason || plan.unsupportedReason || 'Test blocked by prerequisite or policy check.',
      objective: plan.objective,
      instructions: plan.instructions || plan.userInstructions || '',
      userInstructions: plan.userInstructions || plan.instructions || '',
      planner: plan.planner,
      missingCredentials: plan.missingCredentials || [],
      prohibitedActions: plan.prohibitedActions || [],
      durationMs: 0,
      totalSteps: 0,
      executedSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      errorSteps: 0,
      skippedSteps: 0,
      steps: [],
      failure: null,
      pageDiagnostics: null,
    };
  }

  if (activeTests >= MAX_CONCURRENT_TESTS) {
    const error = new Error('Concurrent test limit reached. Please retry in a few moments.');
    error.code = 'CONCURRENCY_LIMIT';
    error.statusCode = 429;
    throw error;
  }

  activeTests++;

  const testStartTime = Date.now();
  const stepTimeoutMs = 6000;

  // 1. Validate target URL and SSRF guards
  const urlValidation = await validateUrl(startUrl, {
    allowLoopback: options.allowLocalForTesting === true,
  });

  let browser = null;
  let context = null;
  let cdp = null;

  try {
    const resolverRules = [
      `MAP ${urlValidation.hostname} ${urlValidation.primaryIp}`,
      options.allowLocalForTesting ? '' : 'MAP 127.0.0.1 ~NOTFOUND',
      options.allowLocalForTesting ? '' : 'MAP localhost ~NOTFOUND',
      'MAP 169.254.169.254 ~NOTFOUND',
      'MAP metadata.google.internal ~NOTFOUND',
      'MAP 100.100.100.200 ~NOTFOUND',
      options.allowLocalForTesting ? '' : 'MAP ::1 ~NOTFOUND',
    ]
      .filter(Boolean)
      .join(', ');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
        '--disable-sync',
        `--host-resolver-rules=${resolverRules}`,
      ],
    });

    context = await browser.newContext({
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      bypassCSP: false,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TestIT-AI/2.0',
    });

    const page = await context.newPage();

    // Attach CDP session to enforce SSRF blocking during all page interactions
    cdp = await context.newCDPSession(page);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

    cdp.on('Fetch.requestPaused', async (event) => {
      const { requestId, request } = event;
      try {
        let isSameOrigin = false;
        try {
          isSameOrigin = new URL(request.url).origin === new URL(startUrl).origin;
        } catch {
          isSameOrigin = false;
        }

        const reqValidation = await validateUrl(request.url, {
          allowLoopback: options.allowLocalForTesting && isSameOrigin,
        });

        if (!reqValidation.isValid) {
          await cdp.send('Fetch.failRequest', {
            requestId,
            errorReason: 'AccessDenied',
          }).catch(() => {});
          return;
        }

        await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
      } catch {
        await cdp.send('Fetch.failRequest', {
          requestId,
          errorReason: 'AccessDenied',
        }).catch(() => {});
      }
    });

    // Initial page load diagnostics
    const navStartTime = Date.now();
    const initialNav = await page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 12000,
    });
    const pageLoadTimeMs = Date.now() - navStartTime;
    const pageTitle = (await page.title().catch(() => '')) || 'Untitled Page';
    const pageHttpStatus = initialNav?.status() || 200;

    const pageDiagnostics = {
      title: pageTitle,
      httpStatus: pageHttpStatus,
      loadTimeMs: pageLoadTimeMs,
    };

    // Execute dynamic, bounded website discovery to map pages, navigation, and controls
    let discoveryResult = null;
    try {
      const priorityKeywords = (plan.objective || '').split(/\s+/).filter((w) => w.length > 3);
      discoveryResult = await discoverWebsite(page, startUrl, {
        allowLocalForTesting: options.allowLocalForTesting === true,
        maxPages: 4,
        timeoutMs: 4000,
        priorityKeywords,
      });
    } catch {
      // Non-fatal if discovery encounters an issue on simple local fixtures
    }

    const stepResults = [];
    let overallStatus = plan.status === 'partial' ? 'partial' : 'passed';
    let failureDetail = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepIndex = i + 1;
      const stepStartTime = Date.now();

      try {
        const outcome = await executeAiStep(page, step, stepTimeoutMs, discoveryResult, startUrl);
        const durationMs = Date.now() - stepStartTime;

        stepResults.push({
          stepIndex,
          id: step.id || `step-${stepIndex}`,
          action: step.action,
          description: step.description || `${step.action} action`,
          status: 'PASS',
          durationMs,
          expected: step.expected || outcome.expected,
          actual: outcome.actual,
          screenshot: outcome.screenshot || null,
        });
      } catch (stepErr) {
        const durationMs = Date.now() - stepStartTime;

        // Categorize the error status precisely
        let stepStatus = 'FAIL';
        if (step.action.startsWith('assert')) {
          // Any assertion failure is FAIL
          stepStatus = 'FAIL';
        } else if (stepErr.statusType === 'BLOCKED') {
          stepStatus = 'BLOCKED';
        } else if (stepErr.statusType === 'FAIL') {
          stepStatus = 'FAIL';
        } else if (
          stepErr.name === 'TimeoutError' ||
          stepErr.message.includes('Timeout') ||
          stepErr.message.includes('Target closed') ||
          stepErr.message.includes('browser has been closed')
        ) {
          stepStatus = 'ERROR';
        } else if (
          stepErr.message.includes('Unable to locate') ||
          stepErr.message.includes('Target button/control is disabled')
        ) {
          stepStatus = 'BLOCKED';
        } else {
          stepStatus = 'ERROR';
        }

        // Set overall status based on highest severity
        if (stepStatus === 'FAIL' || stepStatus === 'ERROR') {
          overallStatus = 'failed';
        } else if (stepStatus === 'BLOCKED' && overallStatus !== 'failed') {
          overallStatus = 'blocked';
        }

        // Capture failure evidence screenshot
        let failScreenshot = null;
        try {
          const buf = await page.screenshot({ type: 'png', timeout: 2000 });
          failScreenshot = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
          // Ignore screenshot error
        }

        const failedUrl = page.url();
        const failedTitle = await page.title().catch(() => '');
        const failedPageInfo = await inspectPageType(page).catch(() => ({}));

        failureDetail = {
          stepIndex,
          stepId: step.id || `step-${stepIndex}`,
          action: step.action,
          status: stepStatus,
          message: stepErr.message,
          currentUrl: failedUrl,
          pageTitle: failedTitle,
          isLoginPage: failedPageInfo.isLoginPage || false,
          isSignupPage: failedPageInfo.isSignupPage || false,
        };

        const prefix =
          stepStatus === 'BLOCKED' ? 'Blocked: ' : stepStatus === 'ERROR' ? 'Error: ' : 'Failed: ';

        stepResults.push({
          stepIndex,
          id: step.id || `step-${stepIndex}`,
          action: step.action,
          description: step.description || `${step.action} action`,
          status: stepStatus,
          durationMs,
          expected: step.expected || `Step ${step.action} executes and verifies successfully`,
          actual: `${prefix}${stepErr.message}`,
          screenshot: failScreenshot,
        });

        // Determine whether subsequent steps are strictly dependent on this step or flow
        const failedFlowId = step.flowId;
        const isAuthGateFailure =
          step.isAuthGate === true ||
          step.action === 'assertAuthenticatedState' ||
          failedFlowId === 'auth';

        // Check if there are independent steps remaining that can still be executed
        let hasIndependentSteps = false;
        if (isAuthGateFailure) {
          for (let k = i + 1; k < plan.steps.length; k++) {
            const candidate = plan.steps[k];
            if (candidate.requiresAuth === false || (candidate.flowId && candidate.flowId !== 'auth')) {
              hasIndependentSteps = true;
              break;
            }
          }
        }

        if (hasIndependentSteps) {
          // Skip only steps that depend on auth or on this failed flow
          let nextRunnableIndex = -1;
          for (let j = i + 1; j < plan.steps.length; j++) {
            const depStep = plan.steps[j];
            const isDependent =
              depStep.requiresAuth === true ||
              depStep.flowId === failedFlowId ||
              depStep.dependsOn === step.id;

            if (isDependent) {
              stepResults.push({
                stepIndex: j + 1,
                id: depStep.id || `step-${j + 1}`,
                action: depStep.action,
                description: depStep.description || `${depStep.action} action`,
                status: 'SKIPPED',
                durationMs: 0,
                expected: depStep.expected || `Step ${depStep.action} executes after prerequisites pass`,
                actual: `Skipped: Dependent on unfulfilled Step ${stepIndex} (${step.action}: ${stepStatus})`,
                screenshot: null,
              });
            } else {
              nextRunnableIndex = j;
              break;
            }
          }

          if (nextRunnableIndex !== -1) {
            // Attempt recovery to public starting point before running next independent flow
            try {
              await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
              await page.waitForTimeout(400);
            } catch {
              // Ignore navigation recovery error
            }
            i = nextRunnableIndex - 1; // outer loop increment will advance to nextRunnableIndex
            continue;
          }
        }

        // If no independent steps remain or this was an unrecoverable failure, skip all remaining steps and break
        for (let j = i + 1; j < plan.steps.length; j++) {
          const depStep = plan.steps[j];
          stepResults.push({
            stepIndex: j + 1,
            id: depStep.id || `step-${j + 1}`,
            action: depStep.action,
            description: depStep.description || `${depStep.action} action`,
            status: 'SKIPPED',
            durationMs: 0,
            expected: depStep.expected || `Step ${depStep.action} executes after prerequisites pass`,
            actual: `Skipped: Prerequisite Step ${stepIndex} (${step.action}) did not succeed (${stepStatus}: ${stepErr.message})`,
            screenshot: null,
          });
        }

        // Halt execution after skipping dependent steps
        break;
      }
    }

    const totalDurationMs = Date.now() - testStartTime;
    const finalUrl = page.url();

    const passedCount = stepResults.filter((s) => s.status === 'PASS' || s.status === 'passed').length;
    const failedCount = stepResults.filter((s) => s.status === 'FAIL' || s.status === 'failed').length;
    const blockedCount = stepResults.filter((s) => s.status === 'BLOCKED' || s.status === 'blocked').length;
    const errorCount = stepResults.filter((s) => s.status === 'ERROR' || s.status === 'error').length;
    const skippedCount = stepResults.filter((s) => s.status === 'SKIPPED' || s.status === 'skipped').length;

    return {
      testName: plan.objective || 'AI Website Test',
      startUrl,
      finalUrl,
      status: overallStatus,
      blockedReason: plan.blockedReason || (overallStatus === 'blocked' ? failureDetail?.message : null),
      objective: plan.objective,
      instructions: plan.instructions || plan.userInstructions || '',
      userInstructions: plan.userInstructions || plan.instructions || '',
      planner: plan.planner,
      missingCredentials: plan.missingCredentials || [],
      prohibitedActions: plan.prohibitedActions || [],
      durationMs: totalDurationMs,
      totalSteps: plan.steps.length,
      executedSteps: stepResults.filter((s) => s.status !== 'SKIPPED' && s.status !== 'skipped').length,
      passedSteps: passedCount,
      failedSteps: failedCount,
      blockedSteps: blockedCount,
      errorSteps: errorCount,
      skippedSteps: skippedCount,
      steps: stepResults,
      failure: failureDetail,
      pageDiagnostics,
      discovery: discoveryResult
        ? {
            pagesFound: discoveryResult.totalPagesExplored,
            searchUrl: discoveryResult.searchPageUrl,
            loginUrl: discoveryResult.loginPageUrl,
          }
        : null,
    };
  } finally {
    if (cdp) {
      await cdp.detach().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    activeTests = Math.max(0, activeTests - 1);
  }
}
