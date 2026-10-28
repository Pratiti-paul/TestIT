import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { validateUrl, isIpBlocked } from '../utils/urlValidator.js';
import {
  checkMetadata,
  checkImages,
  checkAccessibility,
  checkSameOriginLinks,
} from './qualityChecks.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_SCANS = parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 3;

let activeScans = 0;

/**
 * Custom error class for scanner failures with HTTP status codes.
 */
export class ScannerError extends Error {
  constructor(message, code = 'SCAN_ERROR', statusCode = 500) {
    super(message);
    this.name = 'ScannerError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Translates Playwright / Network exceptions into user-safe ScannerError instances.
 *
 * @param {Error} error
 * @param {number} timeoutMs
 * @returns {ScannerError}
 */
function classifyNavigationError(error, timeoutMs) {
  if (error instanceof ScannerError) {
    return error;
  }

  const message = error.message || '';

  if (error.name === 'TimeoutError' || message.includes('Timeout') || message.includes('exceeded')) {
    return new ScannerError(
      `Navigation timed out after ${timeoutMs}ms`,
      'NAVIGATION_TIMEOUT',
      504
    );
  }

  if (message.includes('ERR_ACCESS_DENIED') || message.includes('ERR_BLOCKED_BY_CLIENT')) {
    return new ScannerError(
      'Navigation aborted: destination or redirect target is blocked by security policy',
      'SECURITY_BLOCKED',
      400
    );
  }

  if (message.includes('ERR_NAME_NOT_RESOLVED')) {
    return new ScannerError(
      'Target domain name could not be resolved',
      'DNS_RESOLUTION_FAILED',
      502
    );
  }

  if (message.includes('ERR_CONNECTION_REFUSED')) {
    return new ScannerError(
      'Connection refused by the target server',
      'CONNECTION_REFUSED',
      502
    );
  }

  if (
    message.includes('ERR_CERT') ||
    message.includes('CERT_COMMON_NAME_INVALID') ||
    message.includes('SSL')
  ) {
    return new ScannerError(
      'SSL/TLS certificate verification failed for target server',
      'CERTIFICATE_ERROR',
      502
    );
  }

  if (message.includes('ERR_CONNECTION_RESET') || message.includes('ERR_CONNECTION_TIMED_OUT')) {
    return new ScannerError(
      'Connection to target server was interrupted or timed out',
      'CONNECTION_FAILED',
      502
    );
  }

  return new ScannerError(
    'Failed to navigate to target website',
    'NAVIGATION_FAILED',
    502
  );
}

/**
 * Computes finding totals grouped by severity and category.
 *
 * @param {object[]} findings
 * @returns {{
 *   totalFindings: number,
 *   bySeverity: Record<string, number>,
 *   byCategory: Record<string, number>
 * }}
 */
function generateSummary(findings) {
  const summary = {
    totalFindings: findings.length,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    byCategory: {
      'page-load': 0,
      'javascript-error': 0,
      'console-error': 0,
      'failed-request': 0,
      'broken-link': 0,
      'broken-image': 0,
      'missing-metadata': 0,
      accessibility: 0,
    },
  };

  for (const f of findings) {
    if (summary.bySeverity[f.severity] !== undefined) {
      summary.bySeverity[f.severity]++;
    } else {
      summary.bySeverity[f.severity] = 1;
    }

    if (summary.byCategory[f.category] !== undefined) {
      summary.byCategory[f.category]++;
    } else {
      summary.byCategory[f.category] = 1;
    }
  }

  return summary;
}

/**
 * Scans a target URL using an isolated Playwright Chromium instance with
 * strict SSRF protections, CDP-level request interception, and real quality checks.
 *
 * @param {string} targetUrl
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.allowLocalForTesting] - Internal testing only
 * @param {number} [options.maxLinks]
 * @param {number} [options.linkTimeoutMs]
 * @returns {Promise<{
 *   url: string,
 *   finalUrl: string,
 *   title: string,
 *   httpStatus: number,
 *   headingCount: number,
 *   loadTimeMs: number,
 *   scanDurationMs: number,
 *   summary: object,
 *   checks: object,
 *   findings: object[]
 * }>}
 */
export async function scanWebsite(targetUrl, options = {}) {
  const scanStartTime = Date.now();

  // 1. Initial URL and DNS validation
  const validation = await validateUrl(targetUrl, {
    allowLoopback: options.allowLocalForTesting === true,
  });

  if (!validation.isValid) {
    throw new ScannerError(
      `Invalid URL: ${validation.error}`,
      validation.code || 'INVALID_URL',
      validation.code === 'DNS_RESOLUTION_FAILED' ? 422 : 400
    );
  }

  // 2. Concurrency check
  if (activeScans >= MAX_CONCURRENT_SCANS) {
    throw new ScannerError(
      'Concurrent scan limit reached. Please try again shortly.',
      'CONCURRENCY_LIMIT_REACHED',
      429
    );
  }

  activeScans++;

  const timeoutMs = options.timeoutMs || parseInt(process.env.SCAN_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

  let browser = null;
  let context = null;
  let cdp = null;

  try {
    // 3. Launch isolated Chromium browser
    const resolverRules = [
      `MAP ${validation.hostname} ${validation.primaryIp}`,
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

    // 4. Create ephemeral, restricted context
    context = await browser.newContext({
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      bypassCSP: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TestIT-Scanner/1.0',
      permissions: [],
    });

    const page = await context.newPage();

    // 5. Intercept all requests & redirects via CDP to prevent SSRF
    cdp = await context.newCDPSession(page);
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }],
    });

    cdp.on('Fetch.requestPaused', async (event) => {
      const { requestId, request } = event;
      try {
        const reqValidation = await validateUrl(request.url, {
          allowLoopback: options.allowLocalForTesting && request.url.startsWith(validation.url),
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

    // 6. Register listeners for page errors, console messages, and network failures
    const jsErrors = [];
    const consoleErrors = [];
    const failedRequests = [];
    const seenFailedUrls = new Set();

    page.on('pageerror', (err) => {
      jsErrors.push({
        message: err.message || 'Unknown runtime error',
        name: err.name || 'Error',
      });
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          text: msg.text(),
          location: msg.location(),
        });
      }
    });

    page.on('requestfailed', (req) => {
      const failure = req.failure();
      const errorText = failure ? failure.errorText : 'Request failed';
      // Ignore normal page cancellations on unload
      if (errorText === 'net::ERR_ABORTED') return;
      const url = req.url();
      if (!seenFailedUrls.has(url)) {
        seenFailedUrls.add(url);
        failedRequests.push({
          url,
          method: req.method(),
          resourceType: req.resourceType(),
          errorText,
        });
      }
    });

    page.on('response', (res) => {
      const req = res.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        return;
      }
      const status = res.status();
      if (status >= 400) {
        const url = res.url();
        if (!seenFailedUrls.has(url)) {
          seenFailedUrls.add(url);
          failedRequests.push({
            url,
            method: req.method(),
            resourceType: req.resourceType(),
            statusCode: status,
          });
        }
      }
    });

    // 7. Navigate to target URL
    const navStartTime = Date.now();
    let response = null;

    try {
      response = await page.goto(validation.url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
    } catch (navError) {
      throw classifyNavigationError(navError, timeoutMs);
    }

    const loadTimeMs = Date.now() - navStartTime;

    // 8. Verify remote address
    if (response) {
      const serverAddr = await response.serverAddr().catch(() => null);
      if (serverAddr && serverAddr.ipAddress) {
        const ipCheck = isIpBlocked(serverAddr.ipAddress, {
          allowLoopback: options.allowLocalForTesting === true,
        });
        if (ipCheck.blocked) {
          throw new ScannerError(
            `Connection established to restricted IP address (${serverAddr.ipAddress})`,
            'SECURITY_BLOCKED',
            400
          );
        }
      }
    }

    // 9. Collect basic page metrics
    const finalUrl = page.url();
    const title = (await page.title().catch(() => '')) || '';
    const httpStatus = response ? response.status() : 200;
    const headingCount = await page
      .$$eval('h1, h2, h3, h4, h5, h6', (headings) => headings.length)
      .catch(() => 0);

    // 10. Assemble findings and check statuses
    const findings = [];
    const checks = {};

    // Page Load check
    checks.pageLoad = {
      status: httpStatus >= 400 ? 'issues_found' : 'passed',
      httpStatus,
      durationMs: loadTimeMs,
    };

    if (httpStatus >= 400) {
      findings.push({
        id: randomUUID(),
        category: 'page-load',
        severity: httpStatus >= 500 ? 'critical' : 'high',
        title: `Target website returned HTTP ${httpStatus}`,
        message: `The server responded with an error HTTP status code (${httpStatus}).`,
        url: finalUrl,
        evidence: { httpStatus },
      });
    }

    // JavaScript runtime errors
    for (const err of jsErrors) {
      findings.push({
        id: randomUUID(),
        category: 'javascript-error',
        severity: 'high',
        title: 'Uncaught JavaScript runtime error',
        message: err.message,
        evidence: { name: err.name, message: err.message },
      });
    }
    checks.javascriptErrors = {
      status: jsErrors.length > 0 ? 'issues_found' : 'passed',
      issuesCount: jsErrors.length,
    };

    // Console errors
    for (const cErr of consoleErrors) {
      findings.push({
        id: randomUUID(),
        category: 'console-error',
        severity: 'medium',
        title: 'Browser console error',
        message: cErr.text,
        evidence: { text: cErr.text, location: cErr.location },
      });
    }
    checks.consoleErrors = {
      status: consoleErrors.length > 0 ? 'issues_found' : 'passed',
      issuesCount: consoleErrors.length,
    };

    // Failed network requests
    for (const fReq of failedRequests) {
      findings.push({
        id: randomUUID(),
        category: 'failed-request',
        severity: 'medium',
        title: 'Network request failed',
        message: fReq.statusCode
          ? `Subresource returned HTTP ${fReq.statusCode}`
          : `Network request failed: ${fReq.errorText}`,
        url: fReq.url,
        evidence: {
          url: fReq.url,
          method: fReq.method,
          resourceType: fReq.resourceType,
          statusCode: fReq.statusCode,
          errorText: fReq.errorText,
        },
      });
    }
    checks.networkRequests = {
      status: failedRequests.length > 0 ? 'issues_found' : 'passed',
      issuesCount: failedRequests.length,
    };

    // Page metadata checks (title, meta description, H1)
    try {
      const metaResult = await checkMetadata(page);
      findings.push(...metaResult.findings);
      checks.pageMetadata = {
        status: metaResult.findings.length > 0 ? 'issues_found' : 'passed',
        issuesCount: metaResult.findings.length,
      };
    } catch (err) {
      checks.pageMetadata = { status: 'failed', error: err.message };
    }

    // Broken image checks
    try {
      const imgResult = await checkImages(page);
      findings.push(...imgResult.findings);
      checks.brokenImages = {
        status: imgResult.brokenCount > 0 ? 'issues_found' : 'passed',
        totalChecked: imgResult.totalChecked,
        issuesCount: imgResult.brokenCount,
      };
    } catch (err) {
      checks.brokenImages = { status: 'failed', error: err.message };
    }

    // Accessibility baseline checks (alt attributes & form labels)
    try {
      const a11yResult = await checkAccessibility(page);
      findings.push(...a11yResult.findings);
      checks.accessibility = {
        status: a11yResult.issuesCount > 0 ? 'issues_found' : 'passed',
        issuesCount: a11yResult.issuesCount,
      };
    } catch (err) {
      checks.accessibility = { status: 'failed', error: err.message };
    }

    // Same-origin broken link checks
    try {
      const linkResult = await checkSameOriginLinks(page, finalUrl, {
        allowLocalForTesting: options.allowLocalForTesting,
        maxLinks: options.maxLinks,
        timeoutMs: options.linkTimeoutMs,
      });
      findings.push(...linkResult.findings);
      checks.brokenLinks = {
        status: linkResult.brokenCount > 0 ? 'issues_found' : 'passed',
        totalFound: linkResult.totalFound,
        totalChecked: linkResult.totalChecked,
        issuesCount: linkResult.brokenCount,
      };
    } catch (err) {
      checks.brokenLinks = { status: 'failed', error: err.message };
    }

    const scanDurationMs = Date.now() - scanStartTime;

    return {
      url: targetUrl,
      finalUrl,
      title,
      httpStatus,
      headingCount,
      loadTimeMs,
      scanDurationMs,
      summary: generateSummary(findings),
      checks,
      findings,
    };
  } finally {
    // 11. Resource cleanup
    if (cdp) {
      await cdp.detach().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    activeScans = Math.max(0, activeScans - 1);
  }
}
