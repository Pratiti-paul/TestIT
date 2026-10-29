/**
 * Generic Website Discovery Service
 * Dynamically discovers internal pages, navigation paths, and functional controls
 * using Playwright without guessing hardcoded route names.
 */

import { validateUrl } from '../utils/urlValidator.js';

/**
 * Discovers internal pages, navigation structure, and functional capabilities
 * from a target website using bounded, same-origin traversal.
 *
 * @param {import('playwright').Page} page - Active Playwright page
 * @param {string} startUrl - Initial destination URL
 * @param {object} [options]
 * @param {number} [options.maxPages=5] - Maximum internal pages to inspect
 * @param {number} [options.timeoutMs=5000] - Navigation timeout per page
 * @param {boolean} [options.allowLocalForTesting=false]
 * @param {string[]} [options.priorityKeywords=[]] - Keywords from user task to prioritize links
 * @returns {Promise<object>} Discovery graph and capabilities index
 */
export async function discoverWebsite(pageOrUrl, startUrlOrOptions, maybeOptions = {}) {
  let page = pageOrUrl;
  let startUrl = startUrlOrOptions;
  let options = maybeOptions;
  let ownsBrowser = false;
  let browser = null;

  if (typeof pageOrUrl === 'string') {
    startUrl = pageOrUrl;
    options = typeof startUrlOrOptions === 'object' && startUrlOrOptions !== null ? startUrlOrOptions : {};
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    ownsBrowser = true;
  }

  try {
    const maxPages = options.maxPages || 5;
    const timeoutMs = options.timeoutMs || 5000;
    const allowLocal = options.allowLocalForTesting === true || options.allowLocal === true;
    const priorityKeywords = (options.priorityKeywords || []).map((k) => k.toLowerCase());

  let startOrigin = '';
  try {
    startOrigin = new URL(startUrl).origin;
  } catch {
    startOrigin = '';
  }

  const visitedUrls = new Set();
  const discoveredPages = [];
  const candidateQueue = [];

  // Helper to normalize and check if URL is safe and same-origin
  const sanitizeUrl = (rawHref, base) => {
    try {
      const parsed = new URL(rawHref, base);
      // Filter out non-http(s), fragments-only, or external origins
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (parsed.origin !== startOrigin) return null;
      // Strip hash
      parsed.hash = '';
      return parsed.href;
    } catch {
      return null;
    }
  };

  /**
   * Analyzes an active page's DOM to extract controls, capabilities, and links.
   */
  const inspectCurrentPage = async (currentUrl) => {
    return await page
      .evaluate(() => {
        const getText = (el) => (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');

        const title = document.title || '';

        // 1. Inputs (search, login, form fields)
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).map((i) => {
          const isVisible = i.offsetWidth > 0 && i.offsetHeight > 0;
          const type = (i.getAttribute('type') || i.tagName.toLowerCase()).toLowerCase();
          const placeholder = (i.getAttribute('placeholder') || '').toLowerCase();
          const name = (i.getAttribute('name') || '').toLowerCase();
          const id = (i.getAttribute('id') || '').toLowerCase();
          const ariaLabel = (i.getAttribute('aria-label') || '').toLowerCase();
          let labelText = '';
          if (i.id) {
            const lbl = document.querySelector(`label[for="${i.id}"]`);
            if (lbl) labelText = getText(lbl).toLowerCase();
          }

          return {
            type,
            placeholder,
            name,
            id,
            ariaLabel,
            label: labelText,
            isVisible,
            isSearch:
              type === 'search' ||
              placeholder.includes('search') ||
              name.includes('search') ||
              name === 'q' ||
              ariaLabel.includes('search') ||
              i.getAttribute('role') === 'searchbox' ||
              (id && id.toLowerCase().includes('search')) ||
              (i.className && typeof i.className === 'string' && i.className.toLowerCase().includes('search')),
            isPassword: type === 'password',
            isEmail: type === 'email' || name.includes('email') || placeholder.includes('email'),
          };
        });

        // 2. Buttons
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).map(
          (b) => {
            const isVisible = b.offsetWidth > 0 && b.offsetHeight > 0;
            const text = getText(b).toLowerCase();
            const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
            const type = (b.getAttribute('type') || '').toLowerCase();

            return {
              text: text.slice(0, 50),
              ariaLabel,
              type,
              isVisible,
              isSearchSubmit:
                text.includes('search') ||
                text.includes('🔍') ||
                ariaLabel.includes('search') ||
                (type === 'submit' && b.closest('form')?.querySelector('input[type="search"], input[placeholder*="search" i]')),
              isLoginSubmit:
                text.includes('log in') ||
                text.includes('sign in') ||
                text.includes('login') ||
                text.includes('signin'),
              isAddToCart:
                text.includes('add to cart') ||
                text.includes('add') ||
                ariaLabel.includes('cart') ||
                b.classList.contains('add-to-cart'),
            };
          }
        );

        // 3. Same-origin links
        const rawLinks = Array.from(document.querySelectorAll('a[href]')).map((a) => {
          const isVisible = a.offsetWidth > 0 && a.offsetHeight > 0;
          const text = getText(a);
          const href = a.getAttribute('href') || '';
          const ariaLabel = a.getAttribute('aria-label') || '';

          return {
            text: text.slice(0, 60),
            href,
            ariaLabel,
            isVisible,
          };
        });

        // 4. Products / Items cards
        const productCardCount = document.querySelectorAll(
          '.product-card, .item-card, .product-item, [role="article"], [class*="card"]:has(button), [data-testid*="item" i], [data-testid*="product" i], .card'
        ).length;

        // 5. Cart elements
        const hasCartTable = Boolean(document.querySelector('.cart-page, .cart-items-container, table.cart, .cart-item'));

        return {
          title,
          inputs,
          buttons,
          rawLinks,
          productCardCount,
          hasCartTable,
        };
      })
      .catch(() => ({
        title: '',
        inputs: [],
        buttons: [],
        rawLinks: [],
        productCardCount: 0,
        hasCartTable: false,
      }));
  };

  // Navigate to startUrl if page is not yet there
  if (page.url() !== startUrl) {
    try {
      await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.waitForTimeout(300);
    } catch {
      // Continue with active page
    }
  }

  // Inspect the landing page
  const initialData = await inspectCurrentPage(page.url());
  const initialUrl = page.url();
  visitedUrls.add(initialUrl);

  const initialCapabilities = {
    hasSearchField: initialData.inputs.some((i) => i.isVisible && i.isSearch),
    hasLoginForm: initialData.inputs.some((i) => i.isVisible && i.isPassword),
    hasCatalogItems: initialData.productCardCount > 0,
    hasCartView: initialData.hasCartTable,
  };

  discoveredPages.push({
    url: initialUrl,
    title: initialData.title,
    capabilities: initialCapabilities,
    inputs: initialData.inputs,
    buttons: initialData.buttons,
  });

  // Extract internal candidate links from the initial page
  for (const link of initialData.rawLinks) {
    if (!link.isVisible && !link.text) continue;
    const sanitized = sanitizeUrl(link.href, initialUrl);
    if (!sanitized) continue;

    // Check if not already visited
    if (!visitedUrls.has(sanitized)) {
      // Score link based on keywords
      let score = 0;
      const combinedText = `${link.text} ${link.ariaLabel} ${link.href}`.toLowerCase();

      // Priority keywords from user's request
      for (const kw of priorityKeywords) {
        if (combinedText.includes(kw)) score += 5;
      }

      // Functional keywords
      if (
        combinedText.includes('product') ||
        combinedText.includes('item') ||
        combinedText.includes('shop') ||
        combinedText.includes('catalog') ||
        combinedText.includes('store') ||
        combinedText.includes('browse') ||
        combinedText.includes('collection') ||
        combinedText.includes('inventory') ||
        combinedText.includes('category')
      ) score += 3;
      if (combinedText.includes('search')) score += 4;
      if (combinedText.includes('login') || combinedText.includes('sign in')) score += 3;
      if (combinedText.includes('cart') || combinedText.includes('basket')) score += 3;

      candidateQueue.push({
        href: sanitized,
        text: link.text,
        score,
      });
    }
  }

  // Sort candidates by relevance score descending
  candidateQueue.sort((a, b) => b.score - a.score);

  // Traverse candidate pages up to maxPages limit
  while (candidateQueue.length > 0 && discoveredPages.length < maxPages) {
    const candidate = candidateQueue.shift();
    if (visitedUrls.has(candidate.href)) continue;

    // SSRF security check
    const check = await validateUrl(candidate.href, { allowLoopback: allowLocal });
    if (!check.isValid) continue;

    visitedUrls.add(candidate.href);

    try {
      await page.goto(candidate.href, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(timeoutMs, 4000),
      });
      await page.waitForTimeout(400);

      const navUrl = page.url();
      const pageData = await inspectCurrentPage(navUrl);

      const capabilities = {
        hasSearchField: pageData.inputs.some((i) => i.isVisible && i.isSearch),
        hasLoginForm: pageData.inputs.some((i) => i.isVisible && i.isPassword),
        hasCatalogItems: pageData.productCardCount > 0,
        hasCartView: pageData.hasCartTable,
      };

      discoveredPages.push({
        url: navUrl,
        title: pageData.title,
        navigatedFromText: candidate.text,
        capabilities,
        inputs: pageData.inputs,
        buttons: pageData.buttons,
      });

      // If we found both search and catalog and login, we have enough discovery
      const allFound =
        discoveredPages.some((p) => p.capabilities.hasSearchField) &&
        discoveredPages.some((p) => p.capabilities.hasLoginForm);
      if (allFound) {
        break;
      }
    } catch {
      // Ignore navigation failure on individual candidate links
    }
  }

  // Return browser to starting page cleanly
  try {
    if (page.url() !== startUrl) {
      await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(timeoutMs, 4000),
      });
      await page.waitForTimeout(300);
    }
  } catch {
    // Ignore error returning to startUrl
  }

    return {
      startUrl,
      totalPagesExplored: discoveredPages.length,
      pages: discoveredPages,
      searchPageUrl: discoveredPages.find((p) => p.capabilities.hasSearchField)?.url || null,
      loginPageUrl: discoveredPages.find((p) => p.capabilities.hasLoginForm)?.url || null,
      catalogPageUrl: discoveredPages.find((p) => p.capabilities.hasCatalogItems)?.url || null,
      cartPageUrl: discoveredPages.find((p) => p.capabilities.hasCartView)?.url || null,
    };
  } finally {
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Ensures the browser reaches a page providing the requested target capability
 * (such as an active search input or login controls) using observed discovery evidence.
 *
 * @param {import('playwright').Page} page
 * @param {string} capability - 'search' | 'login' | 'catalog' | 'cart'
 * @param {object} discoveryResult - Output from discoverWebsite()
 * @param {object} [options]
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<{ found: boolean, currentUrl: string, actual: string }>}
 */
export async function navigateToDiscoveredCapability(page, capability, discoveryResult, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const currentUrl = page.url();

  // 1. Check if active page already satisfies capability
  const isSearchTarget = capability === 'search';
  const isLoginTarget = capability === 'login';

  if (isSearchTarget) {
    const hasSearchOnCurrent = await page
      .locator(
        'input[type="search"], input[placeholder*="search" i], [role="searchbox"], input[name="search" i], input[name="q" i], input[class*="search" i], [data-testid*="search" i]'
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (hasSearchOnCurrent) {
      return {
        found: true,
        currentUrl,
        actual: `Search input is present on active page (${currentUrl})`,
      };
    }
  }

  if (isLoginTarget) {
    const hasLoginOnCurrent = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (hasLoginOnCurrent) {
      return {
        found: true,
        currentUrl,
        actual: `Login form is present on active page (${currentUrl})`,
      };
    }
  }

  // 2. Check if discovery indexed a specific target page for this capability
  let targetUrl = null;
  if (isSearchTarget) {
    targetUrl = discoveryResult?.searchPageUrl || discoveryResult?.catalogPageUrl;
  } else if (isLoginTarget) {
    targetUrl = discoveryResult?.loginPageUrl;
  } else if (capability === 'catalog') {
    targetUrl = discoveryResult?.catalogPageUrl || discoveryResult?.searchPageUrl;
  } else if (capability === 'cart') {
    targetUrl = discoveryResult?.cartPageUrl;
  }

  if (targetUrl && targetUrl !== currentUrl) {
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.waitForTimeout(500);

      return {
        found: true,
        currentUrl: page.url(),
        actual: `Navigated to discovered ${capability} interface (${page.url()})`,
      };
    } catch {
      // If direct navigation fails, fall back to link clicking
    }
  }

  // 3. Fallback: discover visible links matching capability on the active page
  let linkSelectors = [];
  if (isSearchTarget || capability === 'catalog') {
    linkSelectors = [
      'a:has-text("Products")',
      'a:has-text("Catalog")',
      'a:has-text("Shop")',
      'a:has-text("Store")',
      'a:has-text("Items")',
      'a:has-text("Browse")',
      'a:has-text("Collection")',
      'a:has-text("Search")',
      'a[href*="product" i]',
      'a[href*="catalog" i]',
      'a[href*="shop" i]',
      'a[href*="store" i]',
      'a[href*="item" i]',
      'a[href*="browse" i]',
      'button:has-text("Products")',
      'button:has-text("Shop")',
      'button:has-text("Catalog")',
    ];
  } else if (isLoginTarget) {
    linkSelectors = [
      'a:has-text("Log in")',
      'a:has-text("Login")',
      'a:has-text("Sign in")',
      'a:has-text("Signin")',
      'a[href*="login" i]',
      'a[href*="signin" i]',
      'button:has-text("Log in")',
      'button:has-text("Login")',
    ];
  }

  for (const selector of linkSelectors) {
    const loc = page.locator(selector).first();
    const isVis = await loc.isVisible({ timeout: 400 }).catch(() => false);
    if (isVis) {
      const prevUrl = page.url();
      await loc.click({ timeout: Math.min(timeoutMs, 4000) });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(500);

      return {
        found: true,
        currentUrl: page.url(),
        actual: `Discovered and followed navigation link ("${selector}") from ${prevUrl} to ${page.url()}`,
      };
    }
  }

  // Dynamic fallback: inspect visible navigation links inside nav / header
  if (isSearchTarget || capability === 'catalog') {
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
        text.includes('cart') ||
        text === '🛒';

      if (!isNonCatalog && (text.length > 0 || href.length > 1)) {
        const prevUrl = page.url();
        await link.click({ timeout: Math.min(timeoutMs, 4000) });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(500);

        return {
          found: true,
          currentUrl: page.url(),
          actual: `Discovered and followed navigation link ("${text || href}") from ${prevUrl} to ${page.url()}`,
        };
      }
    }
  }

  return {
    found: false,
    currentUrl: page.url(),
    actual: `Unable to discover an active ${capability} interface on ${page.url()}`,
  };
}

