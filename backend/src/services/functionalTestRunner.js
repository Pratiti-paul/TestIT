import { chromium } from 'playwright';
import { validateUrl, isIpBlocked } from '../utils/urlValidator.js';
import { validateTestDefinition } from '../utils/functionalTestValidator.js';

const MAX_CONCURRENT_TESTS = parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 3;
let activeTests = 0;

/**
 * Resolves a Playwright locator based on strategy and accessible properties.
 *
 * @param {import('playwright').Page} page
 * @param {object} target
 * @returns {import('playwright').Locator}
 */
export function resolveLocator(page, target) {
  if (!target || typeof target !== 'object') {
    throw new Error('Target configuration is missing');
  }

  const { strategy, value, name, exact } = target;

  switch (strategy) {
    case 'role': {
      const options = {};
      if (name) options.name = name;
      if (exact !== undefined) options.exact = Boolean(exact);
      return page.getByRole(value, options);
    }
    case 'label':
      return page.getByLabel(value, { exact: Boolean(exact) });
    case 'placeholder':
      return page.getByPlaceholder(value, { exact: Boolean(exact) });
    case 'text':
      return page.getByText(value, { exact: Boolean(exact) });
    case 'css':
      return page.locator(value);
    default:
      throw new Error(`Unsupported locator strategy "${strategy}"`);
  }
}

/**
 * Executes a single functional test step against the active page.
 *
 * @param {import('playwright').Page} page
 * @param {object} step
 * @param {number} defaultTimeoutMs
 * @returns {Promise<{ expected: string, actual: string, screenshot?: string }>}
 */
async function executeStep(page, step, defaultTimeoutMs) {
  const timeout = step.timeoutMs || defaultTimeoutMs;

  switch (step.action) {
    case 'navigate': {
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout });
      const currentUrl = page.url();
      return {
        expected: `Navigate to "${step.url}"`,
        actual: `Landed on "${currentUrl}"`,
      };
    }

    case 'click': {
      const locator = resolveLocator(page, step.target);
      await locator.waitFor({ state: 'visible', timeout });
      await locator.click({ timeout });
      return {
        expected: `Click element (${step.target.strategy}: "${step.target.value}")`,
        actual: 'Element clicked successfully',
      };
    }

    case 'fill': {
      const locator = resolveLocator(page, step.target);
      await locator.waitFor({ state: 'visible', timeout });
      await locator.fill(String(step.value), { timeout });
      return {
        expected: `Fill input with "${step.value}"`,
        actual: `Input filled with "${step.value}"`,
      };
    }

    case 'select': {
      const locator = resolveLocator(page, step.target);
      await locator.waitFor({ state: 'visible', timeout });
      await locator.selectOption(String(step.value), { timeout });
      return {
        expected: `Select option "${step.value}"`,
        actual: `Selected option "${step.value}"`,
      };
    }

    case 'assertVisible': {
      const locator = resolveLocator(page, step.target);
      await locator.waitFor({ state: 'visible', timeout });
      return {
        expected: `Element (${step.target.strategy}: "${step.target.value}") is visible`,
        actual: 'Element is visible',
      };
    }

    case 'assertText': {
      const locator = resolveLocator(page, step.target);
      await locator.waitFor({ state: 'visible', timeout });
      const textContent = (await locator.textContent({ timeout })) || '';
      const expectedText = String(step.value);

      const matched = step.exact
        ? textContent.trim() === expectedText.trim()
        : textContent.toLowerCase().includes(expectedText.toLowerCase());

      if (!matched) {
        throw new Error(
          `Text assertion failed. Expected "${expectedText}", but found "${textContent.trim()}".`
        );
      }

      return {
        expected: `Element contains text "${expectedText}"`,
        actual: `Element contains text "${textContent.trim()}"`,
      };
    }

    case 'assertUrl': {
      const currentUrl = page.url();
      const expected = String(step.value);
      const matched = step.exact
        ? currentUrl === expected
        : currentUrl.toLowerCase().includes(expected.toLowerCase());

      if (!matched) {
        throw new Error(
          `URL assertion failed. Expected URL to include "${expected}", but current URL is "${currentUrl}".`
        );
      }

      return {
        expected: `Current URL includes "${expected}"`,
        actual: `Current URL is "${currentUrl}"`,
      };
    }

    case 'assertCount': {
      const locator = resolveLocator(page, step.target);
      const count = await locator.count();
      const expectedCount = Number(step.value);

      if (count !== expectedCount) {
        throw new Error(
          `Count assertion failed. Expected ${expectedCount} elements, but found ${count}.`
        );
      }

      return {
        expected: `Found ${expectedCount} matching elements`,
        actual: `Found ${count} matching elements`,
      };
    }

    case 'screenshot': {
      const buffer = await page.screenshot({ type: 'png', timeout });
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
      return {
        expected: 'Capture evidence screenshot',
        actual: 'Screenshot captured',
        screenshot: base64,
      };
    }

    default:
      throw new Error(`Unsupported action "${step.action}"`);
  }
}

/**
 * Runs a validated functional test definition in a secure Playwright environment.
 *
 * @param {object} testDefinition
 * @param {object} [options]
 * @param {boolean} [options.allowLocalForTesting]
 * @returns {Promise<object>} Execution report
 */
export async function runFunctionalTest(testDefinition, options = {}) {
  // 1. Validation check
  const validationResult = await validateTestDefinition(testDefinition, options);
  if (!validationResult.valid) {
    const error = new Error(`Invalid test definition: ${validationResult.errors.join(' ')}`);
    error.code = 'INVALID_TEST_DEFINITION';
    error.statusCode = 400;
    error.errors = validationResult.errors;
    throw error;
  }

  const def = validationResult.normalizedDefinition;

  // 2. Concurrency check
  if (activeTests >= MAX_CONCURRENT_TESTS) {
    const error = new Error('Concurrent test execution limit reached. Please try again shortly.');
    error.code = 'CONCURRENCY_LIMIT_REACHED';
    error.statusCode = 429;
    throw error;
  }

  activeTests++;

  const testStartTime = Date.now();
  const stepTimeoutMs = def.options?.stepTimeoutMs || 5000;

  // Resolve startUrl for security setup
  const startUrlValidation = await validateUrl(def.startUrl, {
    allowLoopback: options.allowLocalForTesting === true,
  });

  let browser = null;
  let context = null;
  let cdp = null;

  try {
    const resolverRules = [
      `MAP ${startUrlValidation.hostname} ${startUrlValidation.primaryIp}`,
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
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TestIT-Functional/1.0',
      permissions: [],
    });

    const page = await context.newPage();

    // Attach CDP session to block SSRF requests during execution
    cdp = await context.newCDPSession(page);
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }],
    });

    cdp.on('Fetch.requestPaused', async (event) => {
      const { requestId, request } = event;
      try {
        const reqValidation = await validateUrl(request.url, {
          allowLoopback: options.allowLocalForTesting && request.url.startsWith(def.startUrl),
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

    // Initial navigation
    await page.goto(def.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: stepTimeoutMs,
    });

    // Check remote IP
    const initialResponse = await page.waitForLoadState('domcontentloaded').then(() => null).catch(() => null);

    const stepResults = [];
    let overallStatus = 'passed';
    let failureDetail = null;

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      const stepIndex = i + 1;
      const stepStartTime = Date.now();

      try {
        const outcome = await executeStep(page, step, stepTimeoutMs);
        const durationMs = Date.now() - stepStartTime;

        stepResults.push({
          stepIndex,
          id: step.id || `step-${stepIndex}`,
          action: step.action,
          description: step.description || `${step.action} step`,
          status: 'passed',
          durationMs,
          expected: outcome.expected,
          actual: outcome.actual,
          screenshot: outcome.screenshot || null,
        });
      } catch (stepErr) {
        const durationMs = Date.now() - stepStartTime;
        overallStatus = 'failed';

        // Capture failure evidence screenshot
        let failScreenshot = null;
        try {
          const buf = await page.screenshot({ type: 'png', timeout: 2000 });
          failScreenshot = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
          // Ignore screenshot error
        }

        const isAssertionFailure =
          step.action.startsWith('assert') || stepErr.message.includes('assertion failed');

        const stepStatus = isAssertionFailure ? 'failed' : 'error';

        failureDetail = {
          stepIndex,
          stepId: step.id || `step-${stepIndex}`,
          action: step.action,
          message: stepErr.message,
        };

        stepResults.push({
          stepIndex,
          id: step.id || `step-${stepIndex}`,
          action: step.action,
          description: step.description || `${step.action} step`,
          status: stepStatus,
          durationMs,
          expected: `Step ${step.action} executes successfully`,
          actual: `Failed: ${stepErr.message}`,
          screenshot: failScreenshot,
        });

        // Stop further execution on first failure
        break;
      }
    }

    const totalDurationMs = Date.now() - testStartTime;
    const finalUrl = page.url();

    return {
      testName: def.name,
      description: def.description,
      status: overallStatus,
      startUrl: def.startUrl,
      finalUrl,
      durationMs: totalDurationMs,
      totalSteps: def.steps.length,
      executedSteps: stepResults.length,
      passedSteps: stepResults.filter((s) => s.status === 'passed').length,
      failedSteps: stepResults.filter((s) => s.status !== 'passed').length,
      steps: stepResults,
      failure: failureDetail,
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

