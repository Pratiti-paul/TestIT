import { randomUUID } from 'node:crypto';
import { validateUrl } from '../utils/urlValidator.js';

const MAX_LINKS_CHECKED = 30;
const LINK_CHECK_CONCURRENCY = 3;
const LINK_CHECK_TIMEOUT_MS = 5000;

/**
 * Executes a mapped asynchronous task with a fixed concurrency limit.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
async function pLimit(items, mapper, concurrency = LINK_CHECK_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Checks for missing page title, meta description, and H1 heading.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ findings: object[], metaDescription: string|null, h1Count: number }>}
 */
export async function checkMetadata(page) {
  const findings = [];

  // 1. Page Title
  const title = (await page.title().catch(() => '')) || '';
  if (!title.trim()) {
    findings.push({
      id: randomUUID(),
      category: 'missing-metadata',
      severity: 'medium',
      title: 'Missing page title',
      message: 'The page does not have a <title> tag or the title is empty.',
      evidence: { title: null },
    });
  }

  // 2. Meta description
  const metaDescription = await page
    .$eval('meta[name="description" i]', (el) => el.getAttribute('content'))
    .catch(() => null);

  if (!metaDescription || !metaDescription.trim()) {
    findings.push({
      id: randomUUID(),
      category: 'missing-metadata',
      severity: 'low',
      title: 'Missing meta description',
      message: 'The page is missing a <meta name="description"> tag for search engine indexing.',
      evidence: { metaDescription: null },
    });
  }

  // 3. H1 Heading
  const h1Count = await page.$$eval('h1', (headings) => headings.length).catch(() => 0);
  if (h1Count === 0) {
    findings.push({
      id: randomUUID(),
      category: 'missing-metadata',
      severity: 'medium',
      title: 'Missing H1 heading',
      message: 'The page does not contain an <h1> heading tag.',
      evidence: { h1Count: 0 },
    });
  }

  return {
    findings,
    metaDescription: metaDescription?.trim() || null,
    h1Count,
  };
}

/**
 * Detects broken images on the page (failed loads or zero natural dimensions).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ findings: object[], totalChecked: number, brokenCount: number }>}
 */
export async function checkImages(page) {
  const findings = [];

  const images = await page
    .$$eval('img', (imgs) => {
      return imgs.map((img) => ({
        src: img.currentSrc || img.src || img.getAttribute('src') || '',
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }));
    })
    .catch(() => []);

  let brokenCount = 0;

  for (const img of images) {
    if (!img.src) continue;
    // An image is broken if complete is true and natural dimensions are 0
    if (img.complete && (img.naturalWidth === 0 || img.naturalHeight === 0)) {
      brokenCount++;
      findings.push({
        id: randomUUID(),
        category: 'broken-image',
        severity: 'medium',
        title: 'Broken image detected',
        message: 'An image failed to load or rendered with zero dimensions.',
        url: img.src,
        evidence: {
          src: img.src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        },
      });
    }
  }

  return {
    findings,
    totalChecked: images.length,
    brokenCount,
  };
}

/**
 * Performs baseline accessibility checks:
 * 1. Images missing alt attributes (empty alt="" is accepted for decorative images).
 * 2. Form controls without accessible labels.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ findings: object[], issuesCount: number }>}
 */
export async function checkAccessibility(page) {
  const findings = [];

  // Check 1: Images missing alt attributes
  const imagesWithoutAlt = await page
    .$$eval('img:not([alt])', (imgs) => {
      return imgs.map((img) => img.currentSrc || img.src || img.getAttribute('src') || 'unknown');
    })
    .catch(() => []);

  for (const src of imagesWithoutAlt) {
    findings.push({
      id: randomUUID(),
      category: 'accessibility',
      severity: 'low',
      title: 'Image missing alt attribute',
      message: 'An image element is missing an alt attribute for screen readers.',
      url: src !== 'unknown' ? src : undefined,
      evidence: { src },
    });
  }

  // Check 2: Form controls missing accessible labels
  const unlabeledControls = await page
    .$$eval(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea',
      (controls) => {
        return controls
          .map((ctrl) => {
            const id = ctrl.id;
            const name = ctrl.getAttribute('name');
            const type = ctrl.getAttribute('type') || ctrl.tagName.toLowerCase();
            const ariaLabel = ctrl.getAttribute('aria-label');
            const ariaLabelledby = ctrl.getAttribute('aria-labelledby');
            const title = ctrl.getAttribute('title');

            const hasParentLabel = Boolean(ctrl.closest('label'));
            let hasForLabel = false;
            if (id) {
              try {
                hasForLabel = Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`));
              } catch {
                hasForLabel = false;
              }
            }

            const hasAccessibleLabel = Boolean(
              ariaLabel || ariaLabelledby || title || hasParentLabel || hasForLabel
            );

            return {
              tagName: ctrl.tagName.toLowerCase(),
              type,
              id: id || null,
              name: name || null,
              hasAccessibleLabel,
            };
          })
          .filter((c) => !c.hasAccessibleLabel);
      }
    )
    .catch(() => []);

  for (const ctrl of unlabeledControls) {
    findings.push({
      id: randomUUID(),
      category: 'accessibility',
      severity: 'low',
      title: 'Form control missing accessible label',
      message: `A <${ctrl.tagName}> form control has no associated <label>, aria-label, or title.`,
      evidence: {
        tagName: ctrl.tagName,
        type: ctrl.type,
        id: ctrl.id,
        name: ctrl.name,
      },
    });
  }

  return {
    findings,
    issuesCount: findings.length,
  };
}

/**
 * Discovers and checks eligible same-origin HTTP/HTTPS links on the page.
 * Enforces deduplication, maximum link limits, concurrency bounds, and SSRF re-validation.
 *
 * @param {import('playwright').Page} page
 * @param {string} finalUrl
 * @param {object} [options]
 * @param {boolean} [options.allowLocalForTesting]
 * @param {number} [options.maxLinks]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{
 *   findings: object[],
 *   totalFound: number,
 *   totalChecked: number,
 *   brokenCount: number
 * }>}
 */
export async function checkSameOriginLinks(page, finalUrl, options = {}) {
  const maxLinks = options.maxLinks || MAX_LINKS_CHECKED;
  const timeoutMs = options.timeoutMs || LINK_CHECK_TIMEOUT_MS;
  const allowLocal = options.allowLocalForTesting === true;

  let baseOrigin;
  try {
    baseOrigin = new URL(finalUrl).origin;
  } catch {
    return { findings: [], totalFound: 0, totalChecked: 0, brokenCount: 0 };
  }

  // Extract all href attributes from anchor tags
  const rawHrefs = await page
    .$$eval('a[href]', (anchors) => anchors.map((a) => a.getAttribute('href')))
    .catch(() => []);

  const uniqueLinksSet = new Set();

  for (const href of rawHrefs) {
    if (!href || typeof href !== 'string') continue;
    try {
      const resolved = new URL(href, finalUrl);
      // Only same-origin HTTP and HTTPS links
      if (
        (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
        resolved.origin === baseOrigin
      ) {
        resolved.hash = ''; // Remove fragments to prevent redundant duplicate checks
        uniqueLinksSet.add(resolved.href);
      }
    } catch {
      // Ignore malformed href values
    }
  }

  const allEligibleLinks = Array.from(uniqueLinksSet);
  const linksToCheck = allEligibleLinks.slice(0, maxLinks);

  const findings = [];
  let brokenCount = 0;

  await pLimit(linksToCheck, async (linkUrl) => {
    // Revalidate destination with SSRF guard before initiating request
    const validation = await validateUrl(linkUrl, { allowLoopback: allowLocal });
    if (!validation.isValid) {
      // Risky or blocked destination - do not connect
      findings.push({
        id: randomUUID(),
        category: 'broken-link',
        severity: 'high',
        title: 'Link target blocked by security policy',
        message: `Link URL was blocked: ${validation.error}`,
        url: linkUrl,
        evidence: { error: validation.error, code: validation.code },
      });
      brokenCount++;
      return;
    }

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      let res = await fetch(linkUrl, {
        method: 'HEAD',
        signal: abortController.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'TestIT-Scanner/1.0 (+https://testit.dev/bot)' },
      });

      // If HEAD is not allowed (405), fallback to GET
      if (res.status === 405) {
        res = await fetch(linkUrl, {
          method: 'GET',
          signal: abortController.signal,
          redirect: 'manual',
          headers: { 'User-Agent': 'TestIT-Scanner/1.0 (+https://testit.dev/bot)' },
        });
      }

      // Check redirect destination safety
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) {
          try {
            const redirectTarget = new URL(location, linkUrl).href;
            const redirectValidation = await validateUrl(redirectTarget, {
              allowLoopback: allowLocal,
            });
            if (!redirectValidation.isValid) {
              brokenCount++;
              findings.push({
                id: randomUUID(),
                category: 'broken-link',
                severity: 'high',
                title: 'Link redirects to restricted destination',
                message: `Link redirects to blocked target: ${location}`,
                url: linkUrl,
                evidence: {
                  statusCode: res.status,
                  redirectLocation: location,
                  error: redirectValidation.error,
                },
              });
              return;
            }
          } catch {
            brokenCount++;
            findings.push({
              id: randomUUID(),
              category: 'broken-link',
              severity: 'medium',
              title: 'Link has invalid redirect location',
              message: `Link returned an invalid redirect Location header: ${location}`,
              url: linkUrl,
              evidence: { statusCode: res.status, location },
            });
            return;
          }
        }
      }

      // Check for HTTP 4xx and 5xx errors
      if (res.status >= 400) {
        brokenCount++;
        findings.push({
          id: randomUUID(),
          category: 'broken-link',
          severity: res.status === 404 ? 'high' : 'medium',
          title: 'Broken same-origin link',
          message: `The linked page returned HTTP ${res.status}.`,
          url: linkUrl,
          evidence: { statusCode: res.status },
        });
      }
    } catch (err) {
      brokenCount++;
      if (err.name === 'AbortError') {
        findings.push({
          id: randomUUID(),
          category: 'broken-link',
          severity: 'medium',
          title: 'Link check timed out',
          message: `The linked page did not respond within ${timeoutMs}ms.`,
          url: linkUrl,
          evidence: { timeoutMs },
        });
      } else {
        findings.push({
          id: randomUUID(),
          category: 'broken-link',
          severity: 'medium',
          title: 'Link unreachable',
          message: `Failed to connect to linked page: ${err.message}`,
          url: linkUrl,
          evidence: { error: err.message },
        });
      }
    } finally {
      clearTimeout(timer);
    }
  });

  return {
    findings,
    totalFound: allEligibleLinks.length,
    totalChecked: linksToCheck.length,
    brokenCount,
  };
}

