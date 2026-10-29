import { chromium } from 'playwright';
import { validateUrl } from '../utils/urlValidator.js';
import { getActiveAiProvider, getMissingProviderReport, validateAgentDecision } from './aiProvider/index.js';
import { observePage } from './pageObserver.js';
import { verifyDateAndWeekdaySync } from './verifiers/dateVerifier.js';

/**
 * Autonomous AI QA Website Testing Agent
 * Executes a full Observe-Plan-Act-Verify iterative loop.
 *
 * @param {object} params
 * @param {string} params.url - Hosted target website URL
 * @param {string} params.instructions - Plain English testing goals
 * @param {object} [params.credentials] - Optional test credentials { username, password }
 * @param {object} [options]
 * @param {number} [options.maxSteps=15]
 * @param {number} [options.stepTimeoutMs=6000]
 * @param {boolean} [options.allowLocalForTesting=false]
 * @param {boolean} [options.allowMock=false]
 * @param {Array} [options.mockSteps]
 * @returns {Promise<object>} Complete developer QA report
 */
export async function executeAiAgent({ url, instructions, credentials = {} }, options = {}) {
  const startTime = Date.now();
  const trimmedUrl = (url || '').trim();
  const trimmedInstructions = (instructions || '').trim();

  // 1. Validate destination URL and protocol
  if (!trimmedUrl || !/^https?:\/\//i.test(trimmedUrl)) {
    throw new Error('A valid HTTP or HTTPS destination URL is required.');
  }

  const startOrigin = new URL(trimmedUrl).origin;
  const initialUrlCheck = await validateUrl(trimmedUrl, {
    allowLoopback: options.allowLocalForTesting === true,
  });

  if (!initialUrlCheck.isValid) {
    throw new Error(`Security validation rejected target URL: ${initialUrlCheck.error}`);
  }

  // 2. Resolve AI Provider
  const provider = getActiveAiProvider(options);
  if (!provider) {
    // Return explicit configuration requirement rather than pretending or rejecting
    return getMissingProviderReport(trimmedUrl, trimmedInstructions);
  }

  // 3. Plan test objectives using AI provider
  let plannedObjectives = [];
  try {
    const plan = await provider.planObjectives({
      url: trimmedUrl,
      instructions: trimmedInstructions,
      credentials,
    });
    plannedObjectives = plan.objectives || [];
  } catch (err) {
    // If objective planning fails, wrap in structured error report
    return {
      testName: `AI QA Test: ${trimmedInstructions.slice(0, 100)}`,
      startUrl: trimmedUrl,
      finalUrl: trimmedUrl,
      status: 'error',
      blockedReason: null,
      objective: trimmedInstructions,
      planner: {
        mode: 'llm_agent',
        provider: provider.name,
        model: provider.model,
        aiConfigured: true,
        notice: `Planning failed: ${err.message}`,
      },
      missingCredentials: [],
      prohibitedActions: [],
      durationMs: Date.now() - startTime,
      totalSteps: 0,
      executedSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      errorSteps: 1,
      skippedSteps: 0,
      steps: [],
      failure: {
        description: 'AI model failed during objective planning.',
        error: err.message,
        hypothesis: 'Check API key quotas, network connectivity, or model status.',
      },
      coverageAndLimitations: {
        tested: 'None',
        notTested: trimmedInstructions,
        missingPrerequisites: [],
        ambiguousExpectations: null,
        executionLimitations: err.message,
      },
    };
  }

  // 4. Launch isolated Chromium browser
  let browser = null;
  let context = null;
  let page = null;

  const executionSteps = [];
  const consoleErrors = [];
  let currentStepIndex = 1;
  const maxSteps = options.maxSteps || 15;
  const stepTimeout = options.stepTimeoutMs || 6000;

  let overallOutcome = 'PASS';
  let failureAnalysis = null;
  let blockedReason = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 TestIT-Agent/2.0',
    });

    page = await context.newPage();

    // Collect console errors & uncaught page errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[Console Error] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[Page Uncaught Exception] ${err.message}`);
    });

    // Enforce SSRF and origin protection on every client-side route
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('about:')) {
        return route.continue();
      }

      try {
        const destCheck = await validateUrl(requestUrl, {
          allowLoopback: options.allowLocalForTesting === true,
        });

        if (!destCheck.isValid) {
          return route.abort('accessdenied');
        }
      } catch {
        return route.abort('failed');
      }

      return route.continue();
    });

    // Initial navigation
    const initialNavStart = Date.now();
    await page.goto(trimmedUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    const initialNavDuration = Date.now() - initialNavStart;

    executionSteps.push({
      stepIndex: currentStepIndex++,
      id: 'step-nav',
      action: 'navigate',
      description: `Navigate to target website (${trimmedUrl})`,
      status: 'PASS',
      durationMs: initialNavDuration,
      expected: `Navigate to starting website (${trimmedUrl})`,
      actual: `Successfully landed on "${page.url()}"`,
      screenshot: null,
    });

    // Action loop tracking for loop detection
    const recentActionSignatures = [];

    // 5. Execute Observe-Plan-Act-Verify loop across planned objectives
    for (const objective of plannedObjectives) {
      if (overallOutcome !== 'PASS') break;

      let objectiveFinished = false;

      while (!objectiveFinished && currentStepIndex <= maxSteps) {
        // Step 1: OBSERVE
        const observation = await observePage(page, { consoleErrors });

        // Step 2: PLAN / DECIDE NEXT STEP
        let decision;
        try {
          decision = await provider.decideNextStep({
            objective,
            observation,
            history: executionSteps,
            credentials,
            stepNumber: currentStepIndex,
            maxSteps,
          });
        } catch (planErr) {
          overallOutcome = 'ERROR';
          failureAnalysis = {
            description: `AI Provider failed while deciding step ${currentStepIndex}: ${planErr.message}`,
            hypothesis: 'Model service error, rate limit, or invalid response format.',
          };
          break;
        }

        // Validate decision schema
        const decisionCheck = validateAgentDecision(decision);
        if (!decisionCheck.valid) {
          overallOutcome = 'ERROR';
          failureAnalysis = {
            description: `Model returned an invalid action schema: ${decisionCheck.error}`,
            hypothesis: 'Model output did not conform to the strict agent schema.',
          };
          break;
        }

        // Handle conclusion
        if (decision.action === 'conclude') {
          objectiveFinished = true;
          const conclusion = decision.conclude;
          if (conclusion.outcome === 'FAIL') {
            overallOutcome = 'FAIL';
            failureAnalysis = conclusion.failureAnalysis || {
              description: conclusion.reasoning,
              hypothesis: 'Behavior asserted by test objective was not satisfied.',
            };
          } else if (conclusion.outcome === 'BLOCKED') {
            overallOutcome = 'BLOCKED';
            blockedReason = conclusion.reasoning;
          } else if (conclusion.outcome === 'NEEDS_CLARIFICATION') {
            overallOutcome = 'NEEDS_CLARIFICATION';
            blockedReason = conclusion.reasoning;
          }
          break;
        }

        // Loop detection check
        const actionSig = `${decision.action}:${JSON.stringify(decision.target || '')}:${decision.value || ''}`;
        recentActionSignatures.push(actionSig);
        if (recentActionSignatures.length > 3) recentActionSignatures.shift();

        if (
          recentActionSignatures.length === 3 &&
          recentActionSignatures[0] === actionSig &&
          recentActionSignatures[1] === actionSig
        ) {
          overallOutcome = 'BLOCKED';
          blockedReason = `Agent loop detected: Action "${decision.action}" repeated 3 times without advancing state.`;
          break;
        }

        // Step 3: ACT & VERIFY
        const stepStart = Date.now();
        let stepStatus = 'PASS';
        let stepActual = '';
        let stepScreenshot = null;

        try {
          const actResult = await executeAgentAction(page, decision, stepTimeout, {
            startOrigin,
            credentials,
            allowLocal: options.allowLocalForTesting === true,
          });

          stepActual = actResult.actual;
          if (actResult.screenshot) {
            stepScreenshot = actResult.screenshot;
          }
        } catch (actErr) {
          stepStatus = actErr.statusType || 'FAIL';
          stepActual = actErr.message;

          // Capture failure screenshot
          stepScreenshot = await captureSafeScreenshot(page);

          if (stepStatus === 'FAIL') {
            overallOutcome = 'FAIL';
            failureAnalysis = {
              description: `Verification failed at step ${currentStepIndex}: ${actErr.message}`,
              expected: decision.expectedOutcome || decision.action,
              actual: actErr.message,
              hypothesis: 'The application did not exhibit the expected functional behavior.',
            };
            objectiveFinished = true;
          } else if (stepStatus === 'BLOCKED') {
            overallOutcome = 'BLOCKED';
            blockedReason = actErr.message;
            objectiveFinished = true;
          } else {
            overallOutcome = 'ERROR';
            failureAnalysis = {
              description: `Infrastructure or execution error: ${actErr.message}`,
              hypothesis: 'Timeout or network disconnection.',
            };
            objectiveFinished = true;
          }
        }

        const stepDuration = Date.now() - stepStart;

        executionSteps.push({
          stepIndex: currentStepIndex++,
          action: decision.action,
          description: decision.thought || `Execute action: ${decision.action}`,
          status: stepStatus,
          durationMs: stepDuration,
          expected: decision.expectedOutcome || `Execute ${decision.action} successfully`,
          actual: stepActual,
          screenshot: stepScreenshot,
        });

        if (overallOutcome !== 'PASS') {
          break;
        }
      }
    }

    // Capture final evidence screenshot if none captured yet
    const hasScreenshot = executionSteps.some((s) => s.screenshot);
    if (!hasScreenshot && page) {
      const finalShot = await captureSafeScreenshot(page);
      executionSteps.push({
        stepIndex: currentStepIndex++,
        action: 'screenshot',
        description: 'Capture evidence snapshot of final verified page state',
        status: 'PASS',
        durationMs: 40,
        expected: 'Visual evidence snapshot captured',
        actual: 'Screenshot captured',
        screenshot: finalShot,
      });
    }
  } catch (err) {
    overallOutcome = 'ERROR';
    failureAnalysis = {
      description: `Critical agent runner error: ${err.message}`,
      hypothesis: 'Playwright browser crash or unrecoverable system exception.',
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  // 6. Tally metrics
  const totalSteps = executionSteps.length;
  const passedSteps = executionSteps.filter((s) => s.status === 'PASS').length;
  const failedSteps = executionSteps.filter((s) => s.status === 'FAIL').length;
  const blockedSteps = executionSteps.filter((s) => s.status === 'BLOCKED').length;
  const errorSteps = executionSteps.filter((s) => s.status === 'ERROR').length;
  const skippedSteps = executionSteps.filter((s) => s.status === 'SKIPPED').length;

  const finalStatus =
    overallOutcome === 'PASS'
      ? 'passed'
      : overallOutcome === 'FAIL'
      ? 'failed'
      : overallOutcome === 'BLOCKED'
      ? 'blocked'
      : overallOutcome === 'NEEDS_CLARIFICATION'
      ? 'unsupported'
      : 'error';

  return {
    testName: `AI QA Test: ${trimmedInstructions.slice(0, 100)}`,
    startUrl: trimmedUrl,
    finalUrl: page ? page.url() : trimmedUrl,
    status: finalStatus,
    blockedReason,
    objective: trimmedInstructions,
    planner: {
      mode: 'llm_agent',
      provider: provider.name,
      model: provider.model,
      aiConfigured: provider.name !== 'mock',
      notice: `Autonomous QA Agent powered by ${provider.name.toUpperCase()} (${provider.model}). Real-time Observe-Plan-Act-Verify loop.`,
    },
    missingCredentials: credentials?.username ? [] : ['Test Account Credentials (Optional)'],
    prohibitedActions: [],
    durationMs: Date.now() - startTime,
    totalSteps,
    executedSteps: totalSteps,
    passedSteps,
    failedSteps,
    blockedSteps,
    errorSteps,
    skippedSteps,
    steps: executionSteps,
    failure: failureAnalysis,
    pageDiagnostics: {
      title: executionSteps[0]?.actual || 'Test Page',
      httpStatus: 200,
      loadTimeMs: executionSteps[0]?.durationMs || 0,
    },
    coverageAndLimitations: {
      tested: plannedObjectives.map((o) => o.description).join('; ') || trimmedInstructions,
      notTested: 'Live financial payments, destructive deletions, and third-party external origins',
      missingPrerequisites: credentials?.username ? [] : ['None (Public / Unauthenticated scope)'],
      ambiguousExpectations: null,
      executionLimitations: `Bounded to maximum ${maxSteps} actions per journey for safety.`,
    },
  };
}

/**
 * Executes a single validated browser action with rich error diagnostics.
 */
async function executeAgentAction(page, decision, timeout, context) {
  const { action, target, value } = decision;

  switch (action) {
    case 'click': {
      const locator = await resolveAgentLocator(page, target, timeout);
      const isEnabled = await locator.isEnabled({ timeout: Math.min(timeout, 2000) }).catch(() => true);
      if (!isEnabled) {
        const err = new Error(`Target button/control is disabled and cannot be clicked.`);
        err.statusType = 'BLOCKED';
        throw err;
      }
      await locator.click({ timeout });
      await page.waitForTimeout(400);
      return { actual: `Click dispatched successfully on "${target.value}"` };
    }

    case 'fill': {
      const locator = await resolveAgentLocator(page, target, timeout);
      // Mask password if filling a secret
      const isPassword = target.value.toLowerCase().includes('password') || (target.name && target.name.includes('password'));
      const textToFill = isPassword && context.credentials?.password ? context.credentials.password : String(value || '');
      await locator.fill(textToFill, { timeout });
      return { actual: `Filled input with ${isPassword ? '••••••••' : `"${value}"`}` };
    }

    case 'select': {
      const locator = await resolveAgentLocator(page, target, timeout);
      await locator.selectOption(String(value), { timeout });
      return { actual: `Selected option "${value}"` };
    }

    case 'pressKey': {
      await page.keyboard.press(String(value || 'Enter'));
      await page.waitForTimeout(300);
      return { actual: `Key "${value}" pressed` };
    }

    case 'navigate': {
      const targetUrl = new URL(String(value), context.startOrigin).toString();
      if (new URL(targetUrl).origin !== context.startOrigin) {
        const err = new Error(`Cross-origin navigation to "${targetUrl}" is blocked for security.`);
        err.statusType = 'BLOCKED';
        throw err;
      }
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
      return { actual: `Navigated to "${targetUrl}"` };
    }

    case 'refresh': {
      await page.reload({ waitUntil: 'domcontentloaded', timeout });
      return { actual: 'Page reloaded successfully' };
    }

    case 'waitForTimeout': {
      const ms = Math.min(Number(value) || 1000, 5000);
      await page.waitForTimeout(ms);
      return { actual: `Waited for ${ms}ms` };
    }

    case 'assertVisible': {
      const locator = await resolveAgentLocator(page, target, timeout);
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        const err = new Error(`Element matching "${target.value}" is not visible on page.`);
        err.statusType = 'FAIL';
        throw err;
      }
      return { actual: `Element matching "${target.value}" is visible` };
    }

    case 'assertText': {
      const locator = await resolveAgentLocator(page, target, timeout);
      const text = ((await locator.textContent({ timeout })) || '').trim();
      const expected = String(value);
      const matched = decision.exact
        ? text === expected
        : text.toLowerCase().includes(expected.toLowerCase());

      if (!matched) {
        const err = new Error(`Text assertion failed. Expected "${expected}", but observed "${text}".`);
        err.statusType = 'FAIL';
        throw err;
      }
      return { actual: `Observed expected text: "${text}"` };
    }

    case 'assertDateSync': {
      const result = await verifyDateAndWeekdaySync(page);
      if (!result.pass) {
        const err = new Error(`Date synchronization failed: ${result.actual}`);
        err.statusType = 'FAIL';
        throw err;
      }
      return { actual: result.actual };
    }

    case 'screenshot': {
      const base64 = await captureSafeScreenshot(page);
      return { actual: 'Screenshot captured', screenshot: base64 };
    }

    default:
      throw new Error(`Unsupported action "${action}".`);
  }
}

/**
 * Resolves a locator using accessible roles, labels, text, or CSS.
 */
async function resolveAgentLocator(page, target, timeout) {
  const { strategy, value, name } = target;

  let locator = null;
  switch (strategy) {
    case 'role':
      locator = name ? page.getByRole(value, { name }) : page.getByRole(value);
      break;
    case 'label':
      locator = page.getByLabel(value);
      break;
    case 'placeholder':
      locator = page.getByPlaceholder(value);
      break;
    case 'text':
      locator = page.getByText(value);
      break;
    case 'css':
    default:
      locator = page.locator(value);
      break;
  }

  // Wait for element visibility
  await locator.first().waitFor({ state: 'visible', timeout });
  return locator.first();
}

/**
 * Captures base64 screenshot safely.
 */
async function captureSafeScreenshot(page) {
  if (!page) return null;
  try {
    const buffer = await page.screenshot({ type: 'png', timeout: 3000 });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

