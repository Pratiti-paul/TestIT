import { chromium } from 'playwright';
import { validateUrl } from '../utils/urlValidator.js';
import {
  getActiveAiProvider,
  getMissingProviderReport,
  validateAgentDecision,
  sanitizeErrorString,
} from './aiProvider/index.js';
import { observePage } from './pageObserver.js';
import { verifyDateAndWeekdaySync } from './verifiers/dateVerifier.js';
import { verifyAuthenticationSuccess } from './verifiers/authVerifier.js';

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
    // If objective planning fails, wrap in structured error report with sanitized errors
    const sanitizedError = sanitizeErrorString(
      err.message,
      [provider.apiKey, credentials?.password, credentials?.username].filter(Boolean)
    );
    const hypothesis =
      err.category === 'authentication_error'
        ? 'Check that the configured AI provider API key is valid and has appropriate permissions.'
        : err.category === 'rate_limit_error'
        ? 'Check API provider rate limits and account quota.'
        : err.category === 'timeout'
        ? 'AI provider request timed out. Verify network connectivity and provider availability.'
        : err.category === 'service_error'
        ? 'Upstream AI provider is temporarily unavailable. Retry after a moment.'
        : 'Check API key quotas, network connectivity, or model status.';

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
        notice: `Planning failed: ${sanitizedError}`,
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
        error: sanitizedError,
        hypothesis,
      },
      coverageAndLimitations: {
        tested: 'None',
        notTested: trimmedInstructions,
        missingPrerequisites: [],
        ambiguousExpectations: null,
        executionLimitations: sanitizedError,
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
  let sessionIsAuthenticated = false;
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
        const isBlocked = depCheck.status === 'BLOCKED';
        const stepStatus = isBlocked ? 'BLOCKED' : 'SKIPPED';
        executionSteps.push({
          stepIndex: currentStepIndex++,
          objectiveId: objId,
          action: isBlocked ? 'blocked' : 'skip',
          description: `${isBlocked ? 'Blocked' : 'Skip'} objective: ${objective.description}`,
          status: stepStatus,
          durationMs: 0,
          expected: objective.expectedOutcome || (isBlocked ? 'Valid test credentials provided' : 'Step skipped due to unfulfilled dependency'),
          actual: depCheck.reason,
          screenshot: null,
        });
        objectiveOutcomes.set(objId, stepStatus);
        failedObjectiveIds.add(objId);
        if (isBlocked && !blockedReason) {
          blockedReason = depCheck.reason;
        }
        continue;
      }

      // If this objective requires an authenticated session and the browser is not currently authenticated
      // (e.g. after invalid-login testing), restore the authenticated session using valid credentials
      if (
        requiresAuthenticatedSession(objective) &&
        !sessionIsAuthenticated &&
        credentials?.username &&
        credentials?.password &&
        !authFailed &&
        page &&
        !page.isClosed()
      ) {
        const restored = await restoreAuthenticatedSession(
          page,
          credentials,
          currentStepIndex++,
          objId,
          executionSteps,
          stepTimeout,
          options
        );
        if (restored) {
          sessionIsAuthenticated = true;
          authSucceeded = true;
          authFailed = false;
        } else {
          sessionIsAuthenticated = false;
          authSucceeded = false;
          authFailed = true;
          objectiveOutcomes.set(objId, 'FAIL');
          failedObjectiveIds.add(objId);
          continue;
        }
      }

      // If the browser was left on an authentication barrier by a preceding objective
      // and this objective is an independent public objective, return to startUrl to allow testing
      if (
        page &&
        !page.isClosed() &&
        !isLoginVerificationObjective(objective) &&
        !requiresAuthenticatedSession(objective) &&
        page.url() !== trimmedUrl
      ) {
        const barrier = await detectAuthenticationBarrier(page, null, startOrigin);
        if (barrier.isBarrier) {
          try {
            await page.goto(trimmedUrl, { timeout: stepTimeout, waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(300);
          } catch {
            // ignore navigation errors
          }
        }
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

        // Dynamic authentication barrier discovery & expired session detection on non-login objectives
        if (!isLoginVerificationObjective(objective)) {
          const barrier = await detectAuthenticationBarrier(page, observation, startOrigin);
          if (barrier.isBarrier) {
            const wasSessionAuthenticated = sessionIsAuthenticated;
            sessionIsAuthenticated = false;

            if (credentials?.username && credentials?.password && !authFailed) {
              const restored = await restoreAuthenticatedSession(
                page,
                credentials,
                currentStepIndex++,
                objId,
                executionSteps,
                stepTimeout,
                options
              );
              if (restored) {
                sessionIsAuthenticated = true;
                authSucceeded = true;
                authFailed = false;
                try {
                  observation = await observePage(page, { consoleErrors });
                } catch {
                  // ignore observation refresh error
                }
              } else {
                authFailed = true;
                sessionIsAuthenticated = false;
                authSucceeded = false;
                const barrierReason = wasSessionAuthenticated
                  ? 'Blocked: Active session expired and automated session restoration failed with supplied credentials.'
                  : 'Blocked: Authentication prerequisite required (automatic session restoration failed with supplied credentials).';
                objectiveOutcome = 'BLOCKED';
                objectiveFailure = { description: barrierReason };
                if (!blockedReason) blockedReason = barrierReason;
                objectiveFinished = true;
                break;
              }
            } else {
              const barrierReason = wasSessionAuthenticated
                ? `Blocked: Active session expired (${barrier.reason}), but no test account credentials were provided to restore it.`
                : authFailed
                ? 'Blocked: Authentication prerequisite required, but earlier authentication verification failed.'
                : `Blocked: Authentication prerequisite required (${barrier.reason}), but no test account credentials were provided.`;
              executionSteps.push({
                stepIndex: currentStepIndex++,
                objectiveId: objId,
                action: 'blocked',
                description: wasSessionAuthenticated
                  ? `Session expired during objective: ${objective.description}`
                  : `Authentication barrier detected: ${objective.description}`,
                status: 'BLOCKED',
                durationMs: 0,
                expected: wasSessionAuthenticated ? 'Active session maintained' : (objective.expectedOutcome || 'Feature is publicly accessible'),
                actual: barrierReason,
                screenshot: await captureSafeScreenshot(page),
              });
              objectiveOutcome = 'BLOCKED';
              objectiveFailure = { description: barrierReason };
              if (!blockedReason) blockedReason = barrierReason;
              objectiveFinished = true;
              break;
            }
          }
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
          const sanitizedError = sanitizeErrorString(
            planErr.message,
            [provider.apiKey, credentials?.password, credentials?.username].filter(Boolean)
          );
          const hypothesis =
            planErr.category === 'rate_limit_error'
              ? 'Rate limit exceeded during step decision.'
              : planErr.category === 'timeout'
              ? 'Provider timed out during step decision.'
              : planErr.category === 'service_error'
              ? 'Upstream AI service error during step decision.'
              : 'Model service error, rate limit, or invalid response format.';

          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: `AI Provider failed while deciding step ${currentStepIndex}: ${sanitizedError}`,
            hypothesis,
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
          let concludeStatus =
            conclusion.outcome === 'FAIL'
              ? 'FAIL'
              : conclusion.outcome === 'BLOCKED'
              ? 'BLOCKED'
              : conclusion.outcome === 'NEEDS_CLARIFICATION'
              ? 'BLOCKED'
              : 'PASS';

          if (concludeStatus === 'FAIL') {
            if (
              !isLoginVerificationObjective(objective) &&
              (!credentials?.username || !credentials?.password || authFailed)
            ) {
              const barrier = await detectAuthenticationBarrier(page, observation, startOrigin);
              if (barrier.isBarrier) {
                concludeStatus = 'BLOCKED';
                const barrierReason = sessionIsAuthenticated
                  ? `Blocked: Active session expired (${barrier.reason}), but no valid test credentials were provided to restore it.`
                  : `Blocked: Authentication prerequisite required (${barrier.reason}), but no test account credentials were provided.`;
                sessionIsAuthenticated = false;
                conclusion.reasoning = barrierReason;
              }
            }
          }

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
            objective,
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

          // If the action failed because of an unauthenticated barrier or expired session and credentials were not provided, mark as BLOCKED
          if (!isLoginVerificationObjective(objective)) {
            const barrier = await detectAuthenticationBarrier(page, null, startOrigin);
            if (barrier.isBarrier && (!credentials?.username || !credentials?.password || authFailed)) {
              stepStatus = 'BLOCKED';
              stepActual = sessionIsAuthenticated
                ? `Blocked: Active session expired (${barrier.reason}), but no valid test credentials were provided to restore it.`
                : `Blocked: Authentication prerequisite required (${barrier.reason}), but no test account credentials were provided.`;
              sessionIsAuthenticated = false;
            }
          }

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
      const isAuthObjective = isLoginVerificationObjective(objective);

      if (isAuthObjective) {
        const testsValid = requiresValidCredentials(objective);

        if (objectiveOutcome === 'PASS') {
          if (testsValid) {
            // Verify with real browser evidence that authentication actually succeeded
            if (page && !page.isClosed()) {
              const authEvidence = await verifyAuthenticationSuccess(page, {
                submittedUsername: credentials?.username,
                preLoginUrl: trimmedUrl,
              });

              if (authEvidence.pass) {
                authSucceeded = true;
                sessionIsAuthenticated = true;
                authFailed = false;
              } else {
                authFailed = true;
                authSucceeded = false;
                sessionIsAuthenticated = false;
                objectiveOutcome = 'FAIL';
                objectiveFailure = {
                  description: `Authentication verification failed: ${authEvidence.actual}`,
                  hypothesis:
                    'Application did not establish an active session (no URL transition, session token, or user indicator observed).',
                };
                objectiveOutcomes.set(objId, 'FAIL');
                failedObjectiveIds.add(objId);
              }
            } else {
              authFailed = true;
              authSucceeded = false;
              sessionIsAuthenticated = false;
            }
          } else {
            // Invalid-only login verification passed (access was denied as expected)
            // or login-page inspection passed (form controls observed)
            // Session remains strictly unauthenticated
            authSucceeded = false;
            sessionIsAuthenticated = false;
            authFailed = false;
          }
        } else {
          authFailed = true;
          authSucceeded = false;
          sessionIsAuthenticated = false;
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
      const targetStr = `${target?.strategy || ''} ${target?.value || ''} ${target?.name || ''}`.toLowerCase();
      const preClickUrl = page.url();

      let isEnabled = await locator.isEnabled({ timeout: Math.min(timeout, 2000) }).catch(() => true);
      if (!isEnabled) {
        // If the control is currently disabled, check whether a previous submission/request is actively pending
        const loadingInfo = await page
          .evaluate(() => {
            const loadingBtn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => {
              const text = (b.innerText || b.textContent || b.value || '').trim();
              return /loading|logging\s*in|signing\s*in|submitting|please\s*wait/i.test(text);
            });
            const hasAriaBusy = Boolean(document.querySelector('[aria-busy="true"]'));
            const hasSpinner = Boolean(
              document.querySelector('.spinner, [class*="spinner" i], [class*="loading" i], button[disabled] .spinner')
            );
            return {
              isLoading: Boolean(loadingBtn || hasAriaBusy || hasSpinner),
              text: loadingBtn ? (loadingBtn.innerText || loadingBtn.textContent || '').trim() : null,
            };
          })
          .catch(() => ({ isLoading: false, text: null }));

        if (loadingInfo.isLoading) {
          // Bounded wait for in-progress operation to settle rather than failing prematurely
          const settleWaitStart = Date.now();
          const maxWait = Math.min(timeout, 8000);
          let settled = false;
          while (Date.now() - settleWaitStart < maxWait) {
            await page.waitForTimeout(300);
            const stillBusy = await page
              .evaluate(() => {
                const b = Array.from(document.querySelectorAll('button, input[type="submit"]')).find((el) =>
                  /loading|logging\s*in|signing\s*in|submitting|please\s*wait/i.test(el.innerText || el.textContent || '')
                );
                return Boolean(
                  b || document.querySelector('[aria-busy="true"], .spinner, [class*="spinner" i], [class*="loading" i]')
                );
              })
              .catch(() => false);
            if (!stillBusy || page.url() !== preClickUrl) {
              settled = true;
              break;
            }
          }
          if (settled) {
            return { actual: `Waited for in-progress operation ("${loadingInfo.text || 'Loading...'}") to settle.` };
          }
        }

        const err = new Error(`Target button/control is disabled and cannot be clicked.`);
        err.statusType = 'BLOCKED';
        throw err;
      }

      await locator.click({ timeout });
      await page.waitForTimeout(400);

      // Post-click settlement for form submission and login actions
      const isSubmitOrLogin =
        targetStr.includes('submit') ||
        targetStr.includes('login') ||
        targetStr.includes('sign in') ||
        targetStr.includes('log in');

      if (isSubmitOrLogin) {
        const settleStart = Date.now();
        const maxSettleMs = Math.max(timeout, 15000);
        let sawLoadingState = false;

        while (Date.now() - settleStart < maxSettleMs) {
          const settleState = await page
            .evaluate(() => {
              const btn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => {
                const text = (b.innerText || b.textContent || b.value || '').trim();
                return /loading|logging\s*in|signing\s*in|submitting|please\s*wait/i.test(text);
              });
              const hasSpinner = Boolean(
                document.querySelector('.spinner, [class*="spinner" i], [class*="loading" i], [aria-busy="true"]')
              );
              const isLoading = Boolean(btn || hasSpinner);

              const hasError = Boolean(
                document.querySelector(
                  '[role="alert"], .error, .error-message, .auth-error-message, .toast-error, .Toastify__toast--error'
                )
              );
              const hasToken = Boolean(localStorage.getItem('token') || localStorage.getItem('auth_token'));

              return { isLoading, hasError, hasToken };
            })
            .catch(() => ({ isLoading: false, hasError: false, hasToken: false }));

          if (settleState.isLoading) {
            sawLoadingState = true;
          }

          // If navigation away happened, or token stored, or error message appeared:
          if (page.url() !== preClickUrl || settleState.hasToken || settleState.hasError) {
            break;
          }

          // If it was loading and now stopped loading, and we are still on the same page:
          if (sawLoadingState && !settleState.isLoading) {
            await page.waitForTimeout(400);
            break;
          }

          // If we haven't seen loading state yet, wait a minimum buffer (up to 1500ms) before concluding no loading occurred
          if (!sawLoadingState && Date.now() - settleStart > 1500 && !settleState.isLoading) {
            break;
          }

          await page.waitForTimeout(300);
        }

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(300);
      }

      return { actual: `Click dispatched successfully on "${target.value}"` };
    }

    case 'fill': {
      const locator = await resolveAgentLocator(page, target, timeout);

      // Domain-agnostic field attribute & type discovery via target descriptors and DOM element attributes
      const targetStr = `${target?.strategy || ''} ${target?.value || ''} ${target?.name || ''}`.toLowerCase();
      const elemType = (await locator.getAttribute('type').catch(() => ''))?.toLowerCase() || '';
      const elemName = (await locator.getAttribute('name').catch(() => ''))?.toLowerCase() || '';
      const elemPlaceholder = (await locator.getAttribute('placeholder').catch(() => ''))?.toLowerCase() || '';
      const elemAriaLabel = (await locator.getAttribute('aria-label').catch(() => ''))?.toLowerCase() || '';
      const elemAutocomplete = (await locator.getAttribute('autocomplete').catch(() => ''))?.toLowerCase() || '';
      const elemId = (await locator.getAttribute('id').catch(() => ''))?.toLowerCase() || '';

      const isPassword =
        elemType === 'password' ||
        targetStr.includes('password') ||
        elemName.includes('password') ||
        elemPlaceholder.includes('password') ||
        elemId.includes('password') ||
        elemAutocomplete.includes('password');

      const isUsername =
        !isPassword &&
        (
          elemType === 'email' ||
          elemAutocomplete === 'username' ||
          elemAutocomplete === 'email' ||
          /\b(username|email|user|login|identifier|account)\b/i.test(elemName) ||
          /\b(username|email|user|login|identifier|account)\b/i.test(elemPlaceholder) ||
          /\b(username|email|user|login|identifier|account)\b/i.test(elemAriaLabel) ||
          /\b(username|email|user|login|identifier|account)\b/i.test(elemId) ||
          /\b(username|email|user|login|identifier|account)\b/i.test(targetStr)
        );

      const rawVal = String(value !== undefined && value !== null ? value : '');
      const thoughtStr = String(decision?.thought || action?.thought || '').toLowerCase();
      const objBehavior = String(context.objective?.targetBehavior || '').toLowerCase();
      const objDesc = String(context.objective?.description || '').toLowerCase();

      // Detect placeholder tokens intended for valid credential injection
      const isPlaceholderToken =
        rawVal === '[VALID_USERNAME]' ||
        rawVal === '[VALID_PASSWORD]' ||
        rawVal === '' ||
        rawVal === '""' ||
        rawVal === "''";

      // Detect deliberate invalid credential testing
      const isDeliberateInvalidValue =
        !isPlaceholderToken &&
        Boolean(rawVal) &&
        /invalid|wrong|incorrect|bad|fake|test_wrong|fail|dummy|nonexistent/i.test(rawVal);

      const isDeliberateInvalidIntent =
        !isPlaceholderToken &&
        (isDeliberateInvalidValue ||
          ((/\b(invalid|wrong|incorrect|bad|fake)\b.*(user|email|pass|cred|login)/i.test(thoughtStr) ||
            /\b(verify|test|assert|check)\b.*(denied|rejection|failed.*login|invalid.*login)/i.test(thoughtStr)) &&
            !/\b(valid\s*login|valid\s*credential|proceed\s*with.*valid|now.*valid|then.*valid)\b/i.test(thoughtStr)) ||
          ((/\b(invalid\s*login|invalid\s*cred|wrong\s*cred|test\s*invalid)\b/i.test(objBehavior) ||
            /\b(invalid\s*login|invalid\s*cred|wrong\s*cred|test\s*invalid)\b/i.test(objDesc)) &&
            !/valid\s*and\s*invalid/i.test(objBehavior) &&
            !/valid\s*and\s*invalid/i.test(objDesc)));

      let textToFill;
      let displayValue;

      if (isPassword) {
        if (isDeliberateInvalidIntent) {
          textToFill = rawVal || 'wrong_password';
          displayValue = '•••••••• (invalid test password)';
        } else {
          // Exact preservation: AI model must NEVER overwrite, truncate or regenerate supplied password
          textToFill = context.credentials?.password || rawVal;
          displayValue = '••••••••';
        }
      } else if (isUsername) {
        if (isDeliberateInvalidIntent) {
          if (elemType === 'email' && rawVal && !rawVal.includes('@')) {
            textToFill = `${rawVal}@example.com`;
          } else {
            textToFill = rawVal || 'invalid_user@example.com';
          }
          displayValue = `"${textToFill}"`;
        } else {
          // Exact preservation: AI model must NEVER overwrite, truncate or regenerate supplied username/email
          textToFill = context.credentials?.username ? context.credentials.username : rawVal;
          displayValue = `"${textToFill}"`;
        }
      } else {
        textToFill = rawVal;
        displayValue = `"${rawVal}"`;
      }

      await locator.fill(textToFill, { timeout });
      return { actual: `Filled input with ${displayValue}` };
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
      const rawTarget = value || decision.url;
      const targetUrl = new URL(String(rawTarget), context.startOrigin).toString();
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
 * Determines whether an objective tests/verifies login or authentication.
 *
 * @param {object} objective
 * @returns {boolean}
 */
export function isLoginVerificationObjective(objective) {
  if (!objective || typeof objective !== 'object') return false;
  if (objective.isAuthGate === true) return true;

  const text = `${objective.targetBehavior || ''} ${objective.description || ''}`.toLowerCase();

  // If the objective is explicitly about recovering/navigating away from login page back to home or catalog
  if (/\b(recover|return|back\s*to\s*home|navigate\s*away)\b/i.test(text)) {
    return false;
  }

  const isAuthTerm = /\b(log[-_\s]*in|sign[-_\s]*in|logging[-_\s]*in|authenticate|authentication|auth[-_\s]*flow|login[-_\s]*page|signin[-_\s]*page)\b/i.test(text);
  const isTestingTerm = /\b(verify|test|check|attempt|validate|exercise|assert|inspect|observe|view|explore|audit|navigate|reach|open|review|examination|inspection|layout|controls|authenticate|login|sign[-_\s]*in|rejection|denied|error)\b/i.test(text);

  return isAuthTerm && (isTestingTerm || text.includes('credential'));
}

/**
 * Checks whether an objective requires valid test credentials to test successful authentication.
 *
 * @param {object} objective
 * @returns {boolean}
 */
export function requiresValidCredentials(objective) {
  if (!objective || typeof objective !== 'object') return false;
  if (!isLoginVerificationObjective(objective)) return false;

  if (objective.requiresCredentials === true) return true;

  const text = `${objective.targetBehavior || ''} ${objective.description || ''} ${objective.expectedOutcome || ''}`.toLowerCase();
  const preconds = Array.isArray(objective.preconditions) ? objective.preconditions.map(String).join(' ').toLowerCase() : '';
  const combined = `${text} ${preconds}`;

  // If the objective explicitly tests only invalid login (rejection) or inspects login page elements/layout,
  // it does not require supplied valid credentials
  const isInvalidOnly =
    /\b(invalid|wrong|incorrect|bad|fake|rejection|denied)\b/i.test(combined) &&
    !/\b(valid\s*and\s*invalid|valid\s*&\s*invalid|both\s*valid|and\s*valid|valid\s*login|valid\s*credential)\b/i.test(combined);

  const isInspectionOnly =
    /\b(inspect|layout|appearance|elements|controls|observe|view|structure)\b/i.test(combined) &&
    !/\b(valid\s*login|valid\s*credential|submit\s*valid|log\s*in\s*with\s*valid|sign\s*in\s*with\s*valid|successful\s*login)\b/i.test(combined);

  if (isInvalidOnly || isInspectionOnly) {
    return false;
  }

  // Specifically check for valid credentials requirements
  const specifiesValid =
    /\b(valid\s*credential|valid\s*login|valid\s*and\s*invalid|valid\s*&\s*invalid|log\s*in\s*with\s*valid|sign\s*in\s*with\s*valid|using\s*valid|submit\s*valid|successful\s*login|login\s*with\s*valid|sign\s*in\s*with\s*valid|valid\s*user)\b/i.test(combined) ||
    /\b(valid\s*credential|valid\s*login|test\s*credential|account\s*credential)\b/i.test(preconds);

  return Boolean(specifiesValid);
}

/**
 * Checks whether an objective requires an already-authenticated, active session.
 * Login verification objectives NEVER require an existing authenticated session.
 *
 * @param {object} objective
 * @returns {boolean}
 */
export function requiresAuthenticatedSession(objective) {
  if (!objective || typeof objective !== 'object') return false;
  if (isLoginVerificationObjective(objective)) return false;

  if (objective.requiresAuth === true) return true;

  if (Array.isArray(objective.preconditions)) {
    const hasAuthPrecondition = objective.preconditions.some((p) => {
      const pLower = String(p).toLowerCase();
      return (
        pLower.includes('logged in') ||
        pLower.includes('authenticated session') ||
        pLower.includes('active session') ||
        pLower.includes('authenticated user') ||
        pLower.includes('user is authenticated') ||
        pLower.includes('must be logged in') ||
        pLower.includes('existing session')
      );
    });
    if (hasAuthPrecondition) return true;
  }

  const text = `${objective.targetBehavior || ''} ${objective.description || ''}`.toLowerCase();
  if (/\b(authenticated\s*(?:session|order|user|area|route|feature|dashboard)|private\s*(?:profile|account|member|order|setting|history))\b/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Restores a valid authenticated session if an objective requires auth
 * and the active browser session was left unauthenticated (e.g. after invalid-login testing).
 */
export async function restoreAuthenticatedSession(page, credentials, stepIndex, objId, executionSteps, timeout) {
  if (!page || page.isClosed()) return false;
  if (!credentials?.username || !credentials?.password) return false;
  const startMs = Date.now();

  try {
    // Check if the current page has a visible login form
    let hasLoginForm = await page.evaluate(() => {
      const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
        (i) => i.offsetWidth > 0 && i.offsetHeight > 0
      );
      return passInputs.length > 0;
    });

    // If not, see if there is a login link or button to navigate to the login form
    if (!hasLoginForm) {
      const loginLink = page.locator('a[href*="login" i], a[href*="signin" i], a:has-text("Sign in"), a:has-text("Log in"), a:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first();
      const linkVisible = await loginLink.isVisible().catch(() => false);
      if (linkVisible) {
        await loginLink.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(400);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
    }

    // Locate username and password inputs
    const passInput = page.locator('input[type="password"]').first();
    const isPassVisible = await passInput.isVisible({ timeout: 2500 }).catch(() => false);
    if (!isPassVisible) return false;

    const userInput = page.locator('input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="email" i], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[placeholder*="user" i], input[placeholder*="email" i], input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])').first();
    const isUserVisible = await userInput.isVisible({ timeout: 2500 }).catch(() => false);
    if (!isUserVisible) return false;

    // Fill valid credentials (preserving exact supplied values)
    await userInput.fill(credentials.username, { timeout: 3000 });
    await passInput.fill(credentials.password, { timeout: 3000 });

    // Submit form
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In")').first();
    const hasBtn = await submitBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await submitBtn.click({ timeout: 3000 });
    } else {
      await passInput.press('Enter', { timeout: 3000 });
    }

    await page.waitForTimeout(400);
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    // Verify authentication via multi-signal verifier
    const authEvidence = await verifyAuthenticationSuccess(page, {
      submittedUsername: credentials.username,
      preLoginUrl: page.url(),
      timeout: 8000,
    });

    if (authEvidence.pass) {
      executionSteps.push({
        stepIndex,
        objectiveId: objId,
        action: 'restoreSession',
        description: 'Restore valid authenticated session using supplied test credentials',
        status: 'PASS',
        durationMs: Date.now() - startMs,
        expected: 'Active authenticated session established in browser',
        actual: 'Successfully restored authenticated session using valid credentials',
        screenshot: null,
      });
      return true;
    }

    executionSteps.push({
      stepIndex,
      objectiveId: objId,
      action: 'restoreSession',
      description: 'Attempt to restore authenticated session using supplied test credentials',
      status: 'FAIL',
      durationMs: Date.now() - startMs,
      expected: 'Active authenticated session established in browser',
      actual: `Session restoration failed: ${authEvidence.actual}`,
      screenshot: await captureSafeScreenshot(page),
    });
    return false;
  } catch (err) {
    executionSteps.push({
      stepIndex,
      objectiveId: objId,
      action: 'restoreSession',
      description: 'Attempt to restore authenticated session using supplied test credentials',
      status: 'FAIL',
      durationMs: Date.now() - startMs,
      expected: 'Active authenticated session established in browser',
      actual: `Session restoration error: ${err.message}`,
      screenshot: await captureSafeScreenshot(page),
    });
    return false;
  }
}

/**
 * Dynamically detects whether the current browser page is at an authentication barrier
 * (e.g., redirected to a login page, displaying an access-denied/auth-required gate,
 * or presenting a login form on a non-login objective).
 *
 * @param {import('playwright').Page} page
 * @param {object} [observation]
 * @param {string} [startOrigin]
 * @returns {Promise<{ isBarrier: boolean, reason?: string, details?: object }>}
 */
export async function detectAuthenticationBarrier(page, observation, startOrigin) {
  if (!page || page.isClosed()) {
    return { isBarrier: false };
  }

  try {
    const currentUrl = page.url();
    let urlObj;
    try {
      urlObj = new URL(currentUrl);
    } catch {
      urlObj = null;
    }

    const pathname = urlObj ? urlObj.pathname.toLowerCase() : '';
    const search = urlObj ? urlObj.search.toLowerCase() : '';

    // 1. Check URL path for dedicated authentication routes
    const isAuthRoute =
      /\/login\b|\/signin\b|\/sign-in\b|\/log-in\b|\/auth\b|\/session\/new\b|\/users\/sign_in\b|\/accounts\/login\b/i.test(
        pathname
      );

    // 2. Check for redirect query params indicating a protected destination was intercepted
    const hasRedirectParam =
      /[?&](?:redirect|return_to|next|destination|continue|return_url)=/i.test(search);

    // 3. Inspect DOM for visible login inputs, access-denied notices, or login walls
    const pageSignals = await page
      .evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        // Password input presence
        const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
        const hasVisiblePassword = passInputs.length > 0;

        // Submit or login button
        const loginButtons = Array.from(
          document.querySelectorAll('button[type="submit"], input[type="submit"], button, a.btn, [role="button"]')
        ).filter((el) => {
          if (!isVisible(el)) return false;
          const text = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
          return /^(?:sign\s*in|log\s*in|login|signin|authenticate)$/i.test(text);
        });
        const hasLoginSubmit = loginButtons.length > 0;

        // Access-denied / auth-required text in body or alerts
        const bodyText = (document.body ? document.body.innerText || '' : '').toLowerCase();
        const authRequiredPatterns = [
          /please\s+(?:log\s*in|sign\s*in)\s+(?:to\s+continue|to\s+view|to\s+proceed|to\s+access|to\s+use|first)/i,
          /you\s+must\s+(?:be\s+logged\s*in|log\s*in|sign\s*in)/i,
          /authentication\s+(?:required|needed)/i,
          /login\s+required/i,
          /sign\s*in\s+required/i,
          /access\s+denied\s*[:\-–]?\s*(?:please\s+log\s*in|authentication\s+required|401|403)?/i,
          /401\s+unauthorized/i,
          /403\s+forbidden/i,
          /session\s+expired\s*[:\-–]?\s*please\s+(?:log\s*in|sign\s*in)/i,
        ];

        let detectedAuthText = null;
        for (const pattern of authRequiredPatterns) {
          const match = bodyText.match(pattern);
          if (match) {
            detectedAuthText = match[0];
            break;
          }
        }

        // Check headings specifically
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], .alert, [role="alert"]'))
          .filter(isVisible)
          .map((h) => (h.innerText || h.textContent || '').trim());

        const authHeading = headings.find((h) =>
          /^(?:sign\s*in|log\s*in|login|access\s+denied|authentication\s+required|unauthorized)/i.test(h)
        );

        return {
          hasVisiblePassword,
          hasLoginSubmit,
          detectedAuthText,
          authHeading,
        };
      })
      .catch(() => ({
        hasVisiblePassword: false,
        hasLoginSubmit: false,
        detectedAuthText: null,
        authHeading: null,
      }));

    // 4. Check observation text / headings as fallback
    const obsText = `${observation?.title || ''} ${(observation?.headings || []).join(' ')} ${
      observation?.bodySnippet || ''
    }`.toLowerCase();
    const obsHasAuthPhrase =
      /please\s+(?:log\s*in|sign\s*in)|authentication\s+required|you\s+must\s+be\s+logged\s*in|401\s+unauthorized/i.test(
        obsText
      );

    // Evaluate signals
    if (isAuthRoute || hasRedirectParam) {
      if (
        pageSignals.hasVisiblePassword ||
        pageSignals.hasLoginSubmit ||
        pageSignals.detectedAuthText ||
        obsHasAuthPhrase
      ) {
        return {
          isBarrier: true,
          reason: `Authentication barrier detected: Page navigated or redirected to authentication route (${pathname}) requiring credentials.`,
          details: { pathname, isAuthRoute, hasRedirectParam, pageSignals },
        };
      }
    }

    if (pageSignals.detectedAuthText || (pageSignals.authHeading && pageSignals.hasVisiblePassword)) {
      return {
        isBarrier: true,
        reason: `Authentication barrier detected: Page displays access restriction "${
          pageSignals.detectedAuthText || pageSignals.authHeading
        }".`,
        details: { pathname, pageSignals },
      };
    }

    if (pageSignals.hasVisiblePassword && pageSignals.hasLoginSubmit && pageSignals.authHeading) {
      return {
        isBarrier: true,
        reason: `Authentication barrier detected: Login form presented at "${pathname}".`,
        details: { pathname, pageSignals },
      };
    }

    return { isBarrier: false };
  } catch {
    return { isBarrier: false };
  }
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
 * @returns {{ canRun: boolean, status?: 'SKIPPED' | 'BLOCKED', reason?: string }}
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
        status: 'SKIPPED',
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
          status: 'SKIPPED',
          reason: `Skipped: Prerequisite objective "${p}" failed or was not satisfied.`,
        };
      }
    }
  }

  // 3. Login verification objective handling
  if (isLoginVerificationObjective(objective)) {
    // A login-verification objective is EXECUTABLE without an existing authenticated session.
    // It must NEVER be misclassified as requiring an existing session.
    const needsValidCreds = requiresValidCredentials(objective);
    const hasValidCreds = Boolean(credentials?.username && credentials?.password);

    if (needsValidCreds && !hasValidCreds) {
      return {
        canRun: false,
        status: 'BLOCKED',
        reason: 'Blocked: Testing valid login requires test credentials (username and password), but none were provided.',
      };
    }

    return { canRun: true };
  }

  // 4. Authenticated non-login objectives
  const requiresAuth = requiresAuthenticatedSession(objective);

  if (requiresAuth) {
    if (authFailed) {
      return {
        canRun: false,
        status: 'SKIPPED',
        reason: 'Skipped: Requires an authenticated session, but earlier authentication verification failed.',
      };
    }

    if (!credentials?.username && !credentials?.password && !authSucceeded) {
      return {
        canRun: false,
        status: 'SKIPPED',
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

