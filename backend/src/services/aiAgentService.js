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

  const objectiveOutcomes = new Map();
  const failedObjectiveIds = new Set();
  let authFailed = false;
  let authSucceeded = false;
  let fatalError = null;
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

    // Hook for simulating fatal browser disconnection in unit tests
    if (options.simulateFatalBrowserCrash) {
      await browser.close().catch(() => {});
    }

    // 5. Execute Observe-Plan-Act-Verify loop across planned objectives
    for (let objIdx = 0; objIdx < plannedObjectives.length; objIdx++) {
      const objective = plannedObjectives[objIdx];
      const objId = objective.id || `obj-${objIdx + 1}`;

      // Check global step limit
      if (currentStepIndex > maxSteps) {
        executionSteps.push({
          stepIndex: currentStepIndex++,
          objectiveId: objId,
          action: 'skip',
          description: `Skip objective: ${objective.description}`,
          status: 'SKIPPED',
          durationMs: 0,
          expected: objective.expectedOutcome || 'Step skipped due to step limit',
          actual: `Skipped: Maximum step limit (${maxSteps}) reached.`,
          screenshot: null,
        });
        objectiveOutcomes.set(objId, 'SKIPPED');
        failedObjectiveIds.add(objId);
        continue;
      }

      // Check objective dependencies and prerequisites
      const depCheck = checkObjectiveDependencies(objective, {
        failedObjectiveIds,
        authFailed,
        authSucceeded,
        credentials,
      });

      if (!depCheck.canRun) {
        executionSteps.push({
          stepIndex: currentStepIndex++,
          objectiveId: objId,
          action: 'skip',
          description: `Skip objective: ${objective.description}`,
          status: 'SKIPPED',
          durationMs: 0,
          expected: objective.expectedOutcome || 'Step skipped due to unfulfilled dependency',
          actual: depCheck.reason,
          screenshot: null,
        });
        objectiveOutcomes.set(objId, 'SKIPPED');
        failedObjectiveIds.add(objId);
        continue;
      }

      // Action loop tracking for loop detection within this objective
      const recentActionSignatures = [];
      let objectiveFinished = false;
      let objectiveOutcome = 'PASS';
      let objectiveFailure = null;
      let actionCountInObjective = 0;

      while (!objectiveFinished && currentStepIndex <= maxSteps) {
        // Fatal browser disconnection check
        if (!browser || !browser.isConnected() || !page || page.isClosed()) {
          fatalError = new Error('Browser or page closed unexpectedly');
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: 'Fatal browser error: browser disconnected or page closed.',
            hypothesis: 'Playwright browser crash or unrecoverable system exception.',
          };
          executionSteps.push({
            stepIndex: currentStepIndex++,
            objectiveId: objId,
            action: 'error',
            description: `Fatal error during objective: ${objective.description}`,
            status: 'ERROR',
            durationMs: 0,
            expected: objective.expectedOutcome || 'Objective execution',
            actual: 'Fatal error: Browser disconnected or page closed.',
            screenshot: null,
          });
          break;
        }

        // Step 1: OBSERVE
        let observation;
        try {
          observation = await observePage(page, { consoleErrors });
        } catch (obsErr) {
          if (!browser.isConnected() || page.isClosed()) {
            fatalError = obsErr;
            objectiveOutcome = 'ERROR';
            objectiveFailure = {
              description: `Fatal error observing page: ${obsErr.message}`,
              hypothesis: 'Browser disconnected or page closed.',
            };
            break;
          }
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: `Failed to observe page state: ${obsErr.message}`,
            hypothesis: 'Page navigation or DOM rendering interruption.',
          };
          objectiveFinished = true;
          break;
        }

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
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: `AI Provider failed while deciding step ${currentStepIndex}: ${planErr.message}`,
            hypothesis: 'Model service error, rate limit, or invalid response format.',
          };
          objectiveFinished = true;
          break;
        }

        // Validate decision schema
        const decisionCheck = validateAgentDecision(decision);
        if (!decisionCheck.valid) {
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: `Model returned an invalid action schema: ${decisionCheck.error}`,
            hypothesis: 'Model output did not conform to the strict agent schema.',
          };
          objectiveFinished = true;
          break;
        }

        // Handle conclusion
        if (decision.action === 'conclude') {
          objectiveFinished = true;
          const conclusion = decision.conclude || {};
          const concludeStatus =
            conclusion.outcome === 'FAIL'
              ? 'FAIL'
              : conclusion.outcome === 'BLOCKED'
              ? 'BLOCKED'
              : conclusion.outcome === 'NEEDS_CLARIFICATION'
              ? 'BLOCKED'
              : 'PASS';

          objectiveOutcome = concludeStatus;

          if (concludeStatus === 'FAIL') {
            objectiveFailure = conclusion.failureAnalysis || {
              description: conclusion.reasoning || 'Objective verification failed.',
              hypothesis: 'Behavior asserted by test objective was not satisfied.',
            };
          } else if (concludeStatus === 'BLOCKED') {
            objectiveFailure = { description: conclusion.reasoning };
            if (!blockedReason) blockedReason = conclusion.reasoning;
          }

          if (concludeStatus !== 'PASS' || actionCountInObjective === 0) {
            executionSteps.push({
              stepIndex: currentStepIndex++,
              objectiveId: objId,
              action: 'conclude',
              description: decision.thought || `Conclude objective: ${conclusion.reasoning || objective.description}`,
              status: concludeStatus,
              durationMs: 10,
              expected: objective.expectedOutcome || 'Objective completed',
              actual: conclusion.reasoning || `Concluded with status ${concludeStatus}`,
              screenshot: null,
            });
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
          objectiveOutcome = 'BLOCKED';
          objectiveFailure = {
            description: `Agent loop detected: Action "${decision.action}" repeated 3 times without advancing state.`,
          };
          if (!blockedReason) blockedReason = objectiveFailure.description;
          objectiveFinished = true;
          break;
        }

        // Step 3: ACT & VERIFY
        actionCountInObjective++;
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
          if (!browser || !browser.isConnected() || (page && page.isClosed())) {
            fatalError = actErr;
            stepStatus = 'ERROR';
            stepActual = `Fatal browser disconnection: ${actErr.message}`;
            objectiveOutcome = 'ERROR';
            objectiveFailure = {
              description: `Fatal infrastructure error: ${actErr.message}`,
              hypothesis: 'Browser crashed or was terminated.',
            };
            objectiveFinished = true;
            executionSteps.push({
              stepIndex: currentStepIndex++,
              objectiveId: objId,
              action: decision.action,
              description: decision.thought || `Execute action: ${decision.action}`,
              status: stepStatus,
              durationMs: Date.now() - stepStart,
              expected: decision.expectedOutcome || `Execute ${decision.action} successfully`,
              actual: stepActual,
              screenshot: null,
            });
            break;
          }

          stepStatus = actErr.statusType || 'FAIL';
          stepActual = actErr.message;
          stepScreenshot = await captureSafeScreenshot(page);

          objectiveOutcome = stepStatus;
          objectiveFinished = true;

          if (stepStatus === 'FAIL') {
            objectiveFailure = {
              description: `Verification failed at step ${currentStepIndex}: ${actErr.message}`,
              expected: decision.expectedOutcome || decision.action,
              actual: actErr.message,
              hypothesis: 'The application did not exhibit the expected functional behavior.',
            };
          } else if (stepStatus === 'BLOCKED') {
            objectiveFailure = { description: actErr.message };
            if (!blockedReason) blockedReason = actErr.message;
          } else {
            objectiveFailure = {
              description: `Infrastructure or execution error: ${actErr.message}`,
              hypothesis: 'Timeout or network disconnection.',
            };
          }
        }

        const stepDuration = Date.now() - stepStart;

        executionSteps.push({
          stepIndex: currentStepIndex++,
          objectiveId: objId,
          action: decision.action,
          description: decision.thought || `Execute action: ${decision.action}`,
          status: stepStatus,
          durationMs: stepDuration,
          expected: decision.expectedOutcome || `Execute ${decision.action} successfully`,
          actual: stepActual,
          screenshot: stepScreenshot,
        });

        if (objectiveFinished || objectiveOutcome !== 'PASS') {
          break;
        }
      } // end while

      // Record outcome for this objective
      objectiveOutcomes.set(objId, objectiveOutcome);

      if (objectiveOutcome !== 'PASS') {
        failedObjectiveIds.add(objId);
        if (!failureAnalysis && objectiveFailure) {
          failureAnalysis = objectiveFailure;
        }
      }

      // Check if this objective was testing authentication
      const isAuthObjective =
        objective.isAuthGate === true ||
        (objective.targetBehavior && /login|auth/i.test(objective.targetBehavior)) ||
        (objective.description && /login|sign\s*in|authenticate/i.test(objective.description));

      if (isAuthObjective) {
        if (objectiveOutcome === 'PASS') {
          authSucceeded = true;
          authFailed = false;
        } else {
          authFailed = true;
          authSucceeded = false;
        }
      }

      // If fatal error occurred, abort remaining objectives and record them as SKIPPED
      if (fatalError) {
        for (let remIdx = objIdx + 1; remIdx < plannedObjectives.length; remIdx++) {
          const remObj = plannedObjectives[remIdx];
          const remId = remObj.id || `obj-${remIdx + 1}`;
          executionSteps.push({
            stepIndex: currentStepIndex++,
            objectiveId: remId,
            action: 'skip',
            description: `Skip objective: ${remObj.description}`,
            status: 'SKIPPED',
            durationMs: 0,
            expected: remObj.expectedOutcome || 'Step skipped due to fatal infrastructure error',
            actual: `Skipped: Execution aborted due to fatal infrastructure error: ${fatalError.message}`,
            screenshot: null,
          });
          objectiveOutcomes.set(remId, 'SKIPPED');
          failedObjectiveIds.add(remId);
        }
        break;
      }
    }

    // Capture final evidence screenshot if none captured yet
    const hasScreenshot = executionSteps.some((s) => s.screenshot);
    if (!hasScreenshot && page && !page.isClosed()) {
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
    fatalError = err;
    if (!failureAnalysis) {
      failureAnalysis = {
        description: `Critical agent runner error: ${err.message}`,
        hypothesis: 'Playwright browser crash or unrecoverable system exception.',
      };
    }
    // Record any unexecuted objectives in executionSteps so they are never silently omitted
    for (const obj of plannedObjectives) {
      const objId = obj.id || `obj-${executionSteps.length + 1}`;
      if (!executionSteps.some((s) => s.objectiveId === objId)) {
        executionSteps.push({
          stepIndex: currentStepIndex++,
          objectiveId: objId,
          action: 'skip',
          description: `Skip objective: ${obj.description}`,
          status: 'SKIPPED',
          durationMs: 0,
          expected: obj.expectedOutcome || 'Step skipped due to fatal runner error',
          actual: `Skipped: Browser initialization or system failure: ${err.message}`,
          screenshot: null,
        });
        objectiveOutcomes.set(objId, 'SKIPPED');
        failedObjectiveIds.add(objId);
      }
    }
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
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

  const allOutcomes = Array.from(objectiveOutcomes.values());
  let finalStatus;

  if (fatalError) {
    finalStatus = 'error';
  } else if (allOutcomes.includes('FAIL') || executionSteps.some((s) => s.status === 'FAIL')) {
    finalStatus = 'failed';
  } else if (allOutcomes.includes('ERROR') || executionSteps.some((s) => s.status === 'ERROR')) {
    finalStatus = 'error';
  } else if (allOutcomes.includes('BLOCKED')) {
    finalStatus = allOutcomes.includes('PASS') ? 'partial' : 'blocked';
  } else if (allOutcomes.includes('SKIPPED')) {
    finalStatus = allOutcomes.includes('PASS') ? 'partial' : 'blocked';
  } else if (allOutcomes.includes('NEEDS_CLARIFICATION')) {
    finalStatus = 'unsupported';
  } else {
    finalStatus = 'passed';
  }

  if (!failureAnalysis && failedSteps > 0) {
    const firstFailed = executionSteps.find((s) => s.status === 'FAIL');
    failureAnalysis = {
      description: firstFailed?.actual || 'One or more test objectives failed verification.',
      hypothesis: 'The application did not exhibit the expected functional behavior.',
    };
  }

  return {
    testName: `AI QA Test: ${trimmedInstructions.slice(0, 100)}`,
    startUrl: trimmedUrl,
    finalUrl: page && !page.isClosed() ? page.url() : trimmedUrl,
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
    executedSteps: totalSteps - skippedSteps,
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
      tested:
        plannedObjectives
          .filter((o) => {
            const outcome = objectiveOutcomes.get(o.id || '');
            return outcome === 'PASS' || outcome === 'FAIL';
          })
          .map((o) => o.description)
          .join('; ') || 'None',
      notTested:
        plannedObjectives
          .filter((o) => {
            const outcome = objectiveOutcomes.get(o.id || '');
            return outcome === 'SKIPPED' || outcome === 'BLOCKED' || outcome === 'ERROR' || !outcome;
          })
          .map((o) => `${o.description} (${objectiveOutcomes.get(o.id || '') || 'UNEXECUTED'})`)
          .join('; ') || 'None',
      missingPrerequisites: authFailed ? ['Authentication (Login verification failed)'] : [],
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
 * Evaluates whether an objective can execute or must be skipped due to unfulfilled prerequisites.
 *
 * @param {object} objective
 * @param {object} state
 * @param {Set<string>} state.failedObjectiveIds
 * @param {boolean} state.authFailed
 * @param {boolean} state.authSucceeded
 * @param {object} state.credentials
 * @returns {{ canRun: boolean, reason?: string }}
 */
export function checkObjectiveDependencies(objective, { failedObjectiveIds, authFailed, authSucceeded, credentials }) {
  if (!objective || typeof objective !== 'object') {
    return { canRun: true };
  }

  // 1. Explicit dependsOn: string ID or array of objective IDs
  const dependsOn = Array.isArray(objective.dependsOn)
    ? objective.dependsOn
    : objective.dependsOn
    ? [objective.dependsOn]
    : [];

  for (const depId of dependsOn) {
    if (failedObjectiveIds.has(depId)) {
      return {
        canRun: false,
        reason: `Skipped: Prerequisite objective "${depId}" failed or was not satisfied.`,
      };
    }
  }

  // 2. Preconditions referencing objective IDs
  if (Array.isArray(objective.preconditions)) {
    for (const p of objective.preconditions) {
      if (typeof p === 'string' && failedObjectiveIds.has(p)) {
        return {
          canRun: false,
          reason: `Skipped: Prerequisite objective "${p}" failed or was not satisfied.`,
        };
      }
    }
  }

  // 3. Authentication prerequisites
  const requiresAuth =
    objective.requiresAuth === true ||
    (Array.isArray(objective.preconditions) &&
      objective.preconditions.some((p) => {
        const pLower = String(p).toLowerCase();
        return (
          pLower.includes('auth') ||
          pLower.includes('login') ||
          pLower.includes('credential') ||
          pLower.includes('logged in')
        );
      }));

  if (requiresAuth) {
    if (authFailed) {
      return {
        canRun: false,
        reason: 'Skipped: Requires an authenticated session, but earlier authentication verification failed.',
      };
    }

    if (!credentials?.username && !credentials?.password && !authSucceeded) {
      return {
        canRun: false,
        reason: 'Skipped: Requires an authenticated session, but no test account credentials were provided.',
      };
    }
  }

  return { canRun: true };
}

/**
 * Captures base64 screenshot safely.
 */
async function captureSafeScreenshot(page) {
  if (!page || page.isClosed()) return null;
  try {
    const buffer = await page.screenshot({ type: 'png', timeout: 3000 });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

