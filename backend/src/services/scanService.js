import { chromium } from 'playwright';
import { validateUrl, isIpBlocked } from '../utils/urlValidator.js';

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
 * Scans a target URL using an isolated Playwright Chromium instance with
 * strict SSRF protections, CDP-level request interception, and resource limits.
 *
 * @param {string} targetUrl
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.allowLocalForTesting] - Internal testing only
 * @returns {Promise<{
 *   url: string,
 *   finalUrl: string,
 *   title: string,
 *   httpStatus: number,
 *   headingCount: number,
 *   loadTimeMs: number
 * }>}
 */
export async function scanWebsite(targetUrl, options = {}) {
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
    // Host resolver rules pin the target domain to the validated IP and block local/metadata resolutions
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

    // 5. Intercept all requests & redirects via CDP to prevent SSRF and unvalidated redirects
    cdp = await context.newCDPSession(page);
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }],
    });

    cdp.on('Fetch.requestPaused', async (event) => {
      const { requestId, request } = event;
      try {
        // Enforce strict public validation on all subsequent requests and redirects
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

    // 6. Navigate to target URL
    const startTime = Date.now();
    let response = null;

    try {
      response = await page.goto(validation.url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
    } catch (navError) {
      throw classifyNavigationError(navError, timeoutMs);
    }

    const loadTimeMs = Date.now() - startTime;

    // 7. Verify response destination IP address
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

    // 8. Extract page metadata
    const finalUrl = page.url();
    const title = (await page.title().catch(() => '')) || '';
    const httpStatus = response ? response.status() : 200;
    const headingCount = await page
      .$$eval('h1, h2, h3, h4, h5, h6', (headings) => headings.length)
      .catch(() => 0);

    return {
      url: targetUrl,
      finalUrl,
      title,
      httpStatus,
      headingCount,
      loadTimeMs,
    };
  } finally {
    // 9. Clean up all resources
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
