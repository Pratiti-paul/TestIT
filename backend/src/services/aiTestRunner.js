import { chromium } from 'playwright';
import { validateUrl } from '../utils/urlValidator.js';
import { resolveLocator } from './functionalTestRunner.js';

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
export async function ensureLoginPage(page, step, timeout) {
  const currentUrl = page.url();
  const info = await inspectPageType(page);

  // 1. If already on a confirmed login page with controls
  if (info.isLoginPage && info.hasLoginFormControls) {
    return {
      expected: step.expected || 'Confirm active page is the login page',
      actual: `Verified current page is Login Page (${currentUrl}) with login controls`,
    };
  }

  // 2. Discover login navigation link / button
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
async function executeAiStep(page, step, defaultTimeoutMs) {
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

    case 'ensureLoginPage': {
      return await ensureLoginPage(page, step, timeout);
    }

    case 'assertInvalidLogin': {
      return await assertInvalidLogin(page, step, timeout);
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
      const displayVal = step.isSensitive ? '••••••••' : String(step.value);
      return {
        expected: step.expected || `Fill input with "${displayVal}"`,
        actual: `Input filled with "${displayVal}"`,
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

    const stepResults = [];
    let overallStatus = plan.status === 'partial' ? 'partial' : 'passed';
    let failureDetail = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepIndex = i + 1;
      const stepStartTime = Date.now();

      try {
        const outcome = await executeAiStep(page, step, stepTimeoutMs);
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

        failureDetail = {
          stepIndex,
          stepId: step.id || `step-${stepIndex}`,
          action: step.action,
          status: stepStatus,
          message: stepErr.message,
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

        // Record all subsequent dependent steps as SKIPPED
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

        // Halt on step failure/block/error
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
