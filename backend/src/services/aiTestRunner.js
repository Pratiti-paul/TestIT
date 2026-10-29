import { chromium } from 'playwright';
import { validateUrl } from '../utils/urlValidator.js';
import { resolveLocator } from './functionalTestRunner.js';

const MAX_CONCURRENT_TESTS = parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 3;
let activeTests = 0;

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
  throw new Error(
    `Unable to locate accessible control for "${step.description || step.action}". Tried: [${tried}]. The page structure may require clarification or the element is not currently visible.`
  );
}

/**
 * Executes a single AI test step with smart locator fallbacks and verification.
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
        expected: `Navigate to "${step.url}"`,
        actual: `Successfully landed on "${currentUrl}"`,
      };
    }

    case 'click': {
      const locator = await smartFindElement(page, step, timeout);
      await locator.click({ timeout });
      return {
        expected: `Click element: ${step.description}`,
        actual: `Element clicked successfully`,
      };
    }

    case 'fill': {
      const locator = await smartFindElement(page, step, timeout);
      await locator.fill(String(step.value), { timeout });
      const displayVal = step.isSensitive ? '••••••••' : String(step.value);
      return {
        expected: `Fill input with "${displayVal}"`,
        actual: `Input filled with "${displayVal}"`,
      };
    }

    case 'select': {
      const locator = await smartFindElement(page, step, timeout);
      await locator.selectOption(String(step.value), { timeout });
      return {
        expected: `Select option "${step.value}"`,
        actual: `Option "${step.value}" selected`,
      };
    }

    case 'assertVisible': {
      await smartFindElement(page, step, timeout);
      return {
        expected: `Element is visible: ${step.description}`,
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
        throw new Error(
          `Text verification failed. Expected "${expectedText}", but observed "${text.trim()}".`
        );
      }

      return {
        expected: `Element contains text "${expectedText}"`,
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
        throw new Error(
          `URL verification failed. Expected URL to include "${expected}", but current URL is "${currentUrl}".`
        );
      }

      return {
        expected: `URL matches "${expected}"`,
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
        expected: `Found ${expectedCount} elements`,
        actual: `Observed ${count} elements`,
      };
    }

    case 'screenshot': {
      const buffer = await page.screenshot({ type: 'png', timeout });
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
      return {
        expected: 'Capture evidence screenshot of verified page state',
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
  // Handle blocked plans (e.g. safety violations or missing required credentials)
  if (plan.status === 'blocked') {
    return {
      testName: plan.objective || 'AI Website Test',
      startUrl,
      finalUrl: startUrl,
      status: 'blocked',
      blockedReason: plan.blockedReason || 'Test blocked by safety or prerequisite check.',
      objective: plan.objective,
      planner: plan.planner,
      missingCredentials: plan.missingCredentials || [],
      prohibitedActions: plan.prohibitedActions || [],
      durationMs: 0,
      totalSteps: 0,
      executedSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
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
        const reqValidation = await validateUrl(request.url, {
          allowLoopback: options.allowLocalForTesting && request.url.startsWith(startUrl),
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
          description: step.description || `${step.action} action`,
          status: 'failed',
          durationMs,
          expected: `Step ${step.action} executes and verifies successfully`,
          actual: `Failed: ${stepErr.message}`,
          screenshot: failScreenshot,
        });

        // Halt on step failure
        break;
      }
    }

    const totalDurationMs = Date.now() - testStartTime;
    const finalUrl = page.url();

    return {
      testName: plan.objective || 'AI Website Test',
      startUrl,
      finalUrl,
      status: overallStatus,
      blockedReason: plan.blockedReason || null,
      objective: plan.objective,
      planner: plan.planner,
      missingCredentials: plan.missingCredentials || [],
      prohibitedActions: plan.prohibitedActions || [],
      durationMs: totalDurationMs,
      totalSteps: plan.steps.length,
      executedSteps: stepResults.length,
      passedSteps: stepResults.filter((s) => s.status === 'passed').length,
      failedSteps: stepResults.filter((s) => s.status === 'failed').length,
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
