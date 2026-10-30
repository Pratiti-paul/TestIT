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
  const maxSteps = options.maxSteps || 25;
  const stepTimeout = options.stepTimeoutMs || 10000;

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
        plannedObjectives,
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

      // Check if browser already has an active session token or is on authenticated dashboard
      if (!sessionIsAuthenticated && page && !page.isClosed()) {
        const alreadyAuth = await page
          .evaluate(() => {
            const hasToken = Boolean(
              localStorage.getItem('token') ||
                localStorage.getItem('auth_token') ||
                localStorage.getItem('jwt')
            );
            const hasLogout = Array.from(document.querySelectorAll('button, a')).some((b) =>
              /log\s*out|sign\s*out/i.test(b.innerText || b.textContent || '')
            );
            const hasProfileControl = Boolean(
              document.querySelector('[aria-label*="profile" i], [aria-label*="account" i], .user-avatar, .user-profile')
            );
            return hasToken || hasLogout || hasProfileControl;
          })
          .catch(() => false);

        if (alreadyAuth) {
          sessionIsAuthenticated = true;
          authSucceeded = true;
          authFailed = false;
        }
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
        const restoreStep = currentStepIndex;
        const restored = await restoreAuthenticatedSession(
          page,
          credentials,
          restoreStep,
          objId,
          executionSteps,
          stepTimeout,
          options
        );
        if (restored) {
          sessionIsAuthenticated = true;
          authSucceeded = true;
          authFailed = false;
          currentStepIndex = executionSteps.length;
        } else {
          sessionIsAuthenticated = false;
          authSucceeded = false;
          authFailed = true;
          objectiveOutcomes.set(objId, 'FAIL');
          failedObjectiveIds.add(objId);
          if (!executionSteps.some((s) => s.stepIndex === restoreStep || (s.objectiveId === objId && s.action === 'restoreSession'))) {
            executionSteps.push({
              stepIndex: currentStepIndex++,
              objectiveId: objId,
              action: 'restoreSession',
              description: `Restore session for objective: ${objective.description}`,
              status: 'FAIL',
              durationMs: 0,
              expected: 'Active authenticated session established',
              actual: 'Failed to restore authenticated session with supplied credentials',
              screenshot: await captureSafeScreenshot(page),
            });
          } else {
            currentStepIndex = executionSteps.length;
          }
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
      const objectiveStartUrl = page && !page.isClosed() ? page.url() : trimmedUrl;
      const recentActionSignatures = [];
      let objectiveFinished = false;
      let objectiveOutcome = 'PASS';
      let objectiveFailure = null;
      let actionCountInObjective = 0;
      let actionFailuresInObjective = 0;
      let deadClicksInObjective = 0;
      let lastActionWasDeadClick = false;

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

        // Validate decision schema & attempt safe bounded repair
        const decisionCheck = validateAgentDecision(decision, { observation, allowRepair: true });
        if (!decisionCheck.valid) {
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: `Model returned an invalid action schema: ${decisionCheck.error}`,
            hypothesis: 'Model output did not conform to the strict agent schema.',
          };
          objectiveFinished = true;
          break;
        }

        if (decisionCheck.repaired && decisionCheck.repairDetails) {
          console.log('[Action Schema Repair]:', JSON.stringify(decisionCheck.repairDetails));
        }

        // Detect and resolve reasoning vs action value mismatch
        const mismatchCheck = detectActionReasoningMismatch(decision, { credentials, objective });
        if (!mismatchCheck.valid) {
          objectiveOutcome = 'ERROR';
          objectiveFailure = {
            description: mismatchCheck.error,
            hypothesis: 'Model reasoning intent conflicted with executable action value.',
          };
          objectiveFinished = true;
          break;
        }
        if (mismatchCheck.mismatch && mismatchCheck.details) {
          console.log('[Action Reasoning Mismatch Repaired]:', JSON.stringify(mismatchCheck.details));
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

          // Outcome Verification & Guard against false-positive PASS
          if (concludeStatus === 'PASS') {
            // Guard 1: Dead click only
            if (actionCountInObjective > 0 && deadClicksInObjective === actionCountInObjective) {
              concludeStatus = 'FAIL';
              conclusion.reasoning =
                'Verification failed: Action produced no observable functional change or state update (dead click / no-op).';
              objectiveFailure = {
                description: conclusion.reasoning,
                hypothesis: 'Click on control did not trigger any functional state update.',
              };
            }

            // Guard 2: Misleading success notifications
            if (concludeStatus === 'PASS') {
              const misleadingState = await page
                .evaluate(() => {
                  const toastEl = document.querySelector(
                    '[role="status"], [role="alert"], .toast, .alert-success, .notification, .Toastify__toast--success'
                  );
                  const toastText = toastEl ? (toastEl.innerText || toastEl.textContent || '').trim().toLowerCase() : '';
                  const hasSuccessToast = /success|added|saved|created|booked|updated|confirmed/i.test(toastText);
                  if (!hasSuccessToast) return null;

                  const emptyIndicators = Array.from(
                    document.querySelectorAll(
                      '.empty-cart, .cart-empty, .no-items, .empty-state, [data-testid="empty-state"]'
                    )
                  ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
                  const emptyText = emptyIndicators
                    .map((el) => (el.innerText || el.textContent || '').trim().toLowerCase())
                    .join(' ');
                  const isEmptyContainerVisible = /empty|no items|0 items|no bookings|no results/i.test(emptyText);

                  const countBadge = document.querySelector('.cart-count, .item-count, [data-testid="cart-badge"]');
                  const badgeText = countBadge ? (countBadge.innerText || countBadge.textContent || '').trim() : '';
                  const isBadgeZero = badgeText === '0' || badgeText === '0 items';

                  const dataTable = document.querySelector(
                    'table.cart, table.items, table.bookings, [data-testid="items-table"], [data-testid="cart-table"]'
                  );
                  const rowCount = dataTable ? dataTable.querySelectorAll('tbody tr').length : null;
                  const isTableEmpty = rowCount === 0;

                  if (isEmptyContainerVisible || isBadgeZero || isTableEmpty) {
                    return {
                      isMisleading: true,
                      toast: toastText.slice(0, 80),
                      evidence: isEmptyContainerVisible
                        ? emptyText.slice(0, 80)
                        : isBadgeZero
                        ? 'Badge count is 0'
                        : 'Table has 0 rows',
                    };
                  }
                  return null;
                })
                .catch(() => null);

              if (misleadingState?.isMisleading) {
                concludeStatus = 'FAIL';
                conclusion.reasoning = `Verification failed: A success notification ("${misleadingState.toast}") was displayed, but the actual application state is empty (${misleadingState.evidence}). Superficial notification does not reflect persistent state.`;
                objectiveFailure = {
                  description: conclusion.reasoning,
                  hypothesis:
                    'Application showed a misleading success notification while underlying state was not updated or persisted.',
                };
              }
            }

            // Guard 3: Empty search or listing results
            if (concludeStatus === 'PASS') {
              const emptyResultText = await page
                .evaluate(() => {
                  const emptyEl = document.querySelector(
                    '.no-results, .empty-results, [data-testid="no-results"], .alert-info, .empty-state'
                  );
                  const text = (
                    emptyEl
                      ? emptyEl.innerText || emptyEl.textContent || ''
                      : document.body
                      ? document.body.innerText || ''
                      : ''
                  ).toLowerCase();
                  const match = text.match(
                    /\b(?:no\s*results\s*found|0\s*results\s*found|no\s*matching\s*items|no\s*appointments\s*available|no\s*records\s*found)\b/i
                  );
                  return match ? match[0] : null;
                })
                .catch(() => null);

              const objCombined = `${objective.targetBehavior || ''} ${objective.description || ''} ${
                objective.expectedOutcome || ''
              }`.toLowerCase();
              const isSearchOrListObj = /\b(search|find|filter|list|records|catalog)\b/i.test(objCombined);
              const expectsEmpty =
                /\b(expect.*(?:empty|no\s*results)|verify.*(?:empty|no\s*results)|assert.*(?:empty|no\s*results))\b/i.test(
                  objCombined
                );

              if (emptyResultText && isSearchOrListObj && !expectsEmpty) {
                concludeStatus = 'FAIL';
                conclusion.reasoning = `Verification failed: Search or listing returned empty results ("${emptyResultText}"). Requested items or records were not found.`;
                objectiveFailure = {
                  description: conclusion.reasoning,
                  hypothesis: 'Search query produced no matching records in the application.',
                };
              }
            }

            // Guard 4: Active form validation errors preventing completion of valid form submission
            if (concludeStatus === 'PASS') {
              const objCombined = `${objective.targetBehavior || ''} ${objective.description || ''} ${
                objective.expectedOutcome || ''
              }`.toLowerCase();
              const isSubmitValidObj =
                /\b(submit|save|create|register|book|valid\s*form)\b/i.test(objCombined) &&
                !/\b(invalid|reject|denied|validation\s*error|error\s*message)\b/i.test(objCombined);

              if (isSubmitValidObj) {
                const formValidationError = await page
                  .evaluate(() => {
                    const errEls = Array.from(
                      document.querySelectorAll(
                        '.error-message, .invalid-feedback, .field-error, [role="alert"].error, input:invalid'
                      )
                    ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
                    if (errEls.length > 0) {
                      return (
                        errEls[0].innerText ||
                        errEls[0].textContent ||
                        errEls[0].validationMessage ||
                        'Form field validation failed'
                      )
                        .trim()
                        .slice(0, 100);
                    }
                    return null;
                  })
                  .catch(() => null);

                if (formValidationError) {
                  concludeStatus = 'FAIL';
                  conclusion.reasoning = `Verification failed: Form has active validation errors preventing submission: "${formValidationError}".`;
                  objectiveFailure = {
                    description: conclusion.reasoning,
                    hypothesis: 'Form submission failed validation constraints.',
                  };
                }
              }
            }
          }

          objectiveOutcome = concludeStatus;

          if (concludeStatus === 'FAIL') {
            objectiveFailure =
              objectiveFailure ||
              conclusion.failureAnalysis || {
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
          if (actResult.isDeadClick) {
            deadClicksInObjective++;
            lastActionWasDeadClick = true;
            stepStatus = 'UNVERIFIED';
          } else {
            lastActionWasDeadClick = false;
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

          // Ambiguity Error: Never guess an arbitrary control when multiple match!
          if (actErr.isAmbiguous) {
            stepStatus = 'BLOCKED';
            stepActual = actErr.message;
            stepScreenshot = await captureSafeScreenshot(page);
            objectiveOutcome = 'BLOCKED';
            objectiveFailure = { description: actErr.message };
            if (!blockedReason) blockedReason = actErr.message;
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
              screenshot: stepScreenshot,
            });
            break;
          }

          // If the action failed because of an unauthenticated barrier or expired session and credentials were not provided, mark as BLOCKED
          if (!isLoginVerificationObjective(objective)) {
            const barrier = await detectAuthenticationBarrier(page, null, startOrigin);
            if (barrier.isBarrier && (!credentials?.username || !credentials?.password || authFailed)) {
              stepStatus = 'BLOCKED';
              stepActual = sessionIsAuthenticated
                ? `Blocked: Active session expired (${barrier.reason}), but no valid test credentials were provided to restore it.`
                : `Blocked: Authentication prerequisite required (${barrier.reason}), but no test account credentials were provided.`;
              sessionIsAuthenticated = false;
              objectiveOutcome = 'BLOCKED';
              objectiveFailure = { description: stepActual };
              if (!blockedReason) blockedReason = stepActual;
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
                screenshot: stepScreenshot,
              });
              break;
            }
          }

          // Adaptive Recovery: Allow up to 1 retry per objective to observe updated state and pick alternative action
          if (actionFailuresInObjective < 1) {
            actionFailuresInObjective++;
            stepStatus = 'FAIL';
            stepActual = actErr.message;
            stepScreenshot = await captureSafeScreenshot(page);
            executionSteps.push({
              stepIndex: currentStepIndex++,
              objectiveId: objId,
              action: decision.action,
              description: decision.thought || `Execute action: ${decision.action}`,
              status: stepStatus,
              isRecovered: true,
              durationMs: Date.now() - stepStart,
              expected: decision.expectedOutcome || `Execute ${decision.action} successfully`,
              actual: `${stepActual} (Adaptive recovery: Page state refreshed to adapt strategy)`,
              screenshot: stepScreenshot,
            });
            console.log(`[Adaptive Recovery]: Action "${decision.action}" failed: ${actErr.message}. Refreshing page state.`);
            continue;
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
              hypothesis: 'The application did not exhibit the expected functional behavior after locator resolution and retry.',
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

          executionSteps.push({
            stepIndex: currentStepIndex++,
            objectiveId: objId,
            action: decision.action,
            description: decision.thought || `Execute action: ${decision.action}`,
            status: stepStatus,
            durationMs: Date.now() - stepStart,
            expected: decision.expectedOutcome || `Execute ${decision.action} successfully`,
            actual: stepActual,
            screenshot: stepScreenshot,
          });
          break;
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
            const hasSubmitAction = executionSteps.some(
              (s) => s.objectiveId === objId && (s.action === 'click' || s.action === 'press')
            );

            // Verify with real browser evidence that authentication actually succeeded
            if (hasSubmitAction && page && !page.isClosed()) {
              const authVerifyStart = Date.now();
              const authEvidence = await verifyAuthenticationSuccess(page, {
                submittedUsername: credentials?.username,
                preLoginUrl: objectiveStartUrl,
              });
              console.log('[Auth Evidence Result]:', JSON.stringify({ pass: authEvidence.pass, status: authEvidence.status, actual: authEvidence.actual, currentUrl: page.url() }));

              const authScreenshot = await captureSafeScreenshot(page);
              executionSteps.push({
                stepIndex: currentStepIndex++,
                objectiveId: objId,
                action: 'verifyAuthentication',
                description: 'Verify successful authentication through browser session evidence',
                status: authEvidence.pass ? 'PASS' : 'FAIL',
                durationMs: Date.now() - authVerifyStart,
                expected: 'Application establishes an authenticated session and transitions away from login form',
                actual: authEvidence.actual,
                screenshot: authScreenshot,
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
                if (!failureAnalysis) {
                  failureAnalysis = objectiveFailure;
                }
                objectiveOutcomes.set(objId, 'FAIL');
                failedObjectiveIds.add(objId);
              }
            } else if (hasSubmitAction) {
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
          if (testsValid) {
            authFailed = true;
            authSucceeded = false;
            sessionIsAuthenticated = false;
          } else {
            // Failure of an invalid-only or negative test does NOT mean valid authentication failed
            authSucceeded = false;
            sessionIsAuthenticated = false;
          }
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
  const failedSteps = executionSteps.filter((s) => s.status === 'FAIL' && !s.isRecovered).length;
  const blockedSteps = executionSteps.filter((s) => s.status === 'BLOCKED').length;
  const errorSteps = executionSteps.filter((s) => s.status === 'ERROR').length;
  const skippedSteps = executionSteps.filter((s) => s.status === 'SKIPPED').length;

  const allOutcomes = Array.from(objectiveOutcomes.values());
  let finalStatus;

  if (fatalError) {
    finalStatus = 'error';
  } else if (allOutcomes.includes('FAIL') || executionSteps.some((s) => s.status === 'FAIL' && !s.isRecovered)) {
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
      const locator = await resolveAgentLocator(page, target, timeout, decision, context);
      const targetStr = `${target?.strategy || ''} ${target?.value || ''} ${target?.name || ''}`.toLowerCase();
      const preClickUrl = page.url();

      let isEnabled = await locator.isEnabled({ timeout: Math.min(timeout, 2000) }).catch(() => true);
      const isDisabledAttr = await locator
        .evaluate((el) => {
          return (
            el.disabled === true ||
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('disabled')
          );
        })
        .catch(() => false);

      if (!isEnabled || isDisabledAttr) {
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

      // Pre-click snapshot for dead-click detection
      const preClickSnapshot = await page
        .evaluate(() => {
          return {
            textLength: (document.body?.innerText || '').length,
            domCount: document.querySelectorAll('*').length,
            tableRows: document.querySelectorAll('tr, li, [role="row"]').length,
          };
        })
        .catch(() => null);

      await locator.click({ timeout });
      await page.waitForTimeout(400);

      // Post-click settlement for form submission and login actions
      const isSubmitOrLogin =
        targetStr.includes('submit') ||
        targetStr.includes('login') ||
        targetStr.includes('sign in') ||
        targetStr.includes('log in') ||
        /\b(submit|login|sign\s*in|log\s*in)\b/i.test(decision?.thought || '');

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

          // If navigation away happened:
          if (page.url() !== preClickUrl) {
            break;
          }

          // If auth token was stored, wait for SPA navigation away from login
          if (settleState.hasToken) {
            await page
              .waitForURL(
                (u) => {
                  try {
                    return new URL(u).pathname !== new URL(preClickUrl).pathname;
                  } catch {
                    return u !== preClickUrl;
                  }
                },
                { timeout: 3500 }
              )
              .catch(() => {});
            await page.waitForTimeout(400);
            break;
          }

          // If page is currently loading, never break early (even if a stale error message is in the DOM)
          if (settleState.isLoading) {
            await page.waitForTimeout(300);
            continue;
          }

          // If an error alert is visible and loading has finished:
          if (settleState.hasError && sawLoadingState) {
            await page.waitForTimeout(400);
            break;
          }

          // If it was loading and now stopped loading, and we are still on the same page:
          if (sawLoadingState && !settleState.isLoading) {
            await page.waitForTimeout(500);
            break;
          }

          // If we haven't seen loading state yet, wait a minimum buffer (up to 4000ms) before concluding no loading occurred
          if (!sawLoadingState && Date.now() - settleStart > 4000 && !settleState.isLoading) {
            break;
          }

          await page.waitForTimeout(300);
        }

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(300);
      }

      const postClickUrl = page.url();
      const postClickSnapshot = await page
        .evaluate(() => {
          const el = document.querySelector(
            '[role="status"], [role="alert"], .alert, .modal, .toast, .confirmation, [aria-live="polite"], .booking-confirmation, .order-confirmation'
          );
          const notification =
            el && el.offsetWidth > 0 && el.offsetHeight > 0
              ? (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
              : null;

          return {
            textLength: (document.body?.innerText || '').length,
            domCount: document.querySelectorAll('*').length,
            tableRows: document.querySelectorAll('tr, li, [role="row"]').length,
            notification,
          };
        })
        .catch(() => null);

      const isUrlChanged = postClickUrl !== preClickUrl;
      const isNotificationShown = Boolean(postClickSnapshot?.notification);
      const isDomChanged =
        !preClickSnapshot ||
        !postClickSnapshot ||
        Math.abs(postClickSnapshot.textLength - preClickSnapshot.textLength) > 0 ||
        postClickSnapshot.domCount !== preClickSnapshot.domCount ||
        postClickSnapshot.tableRows !== preClickSnapshot.tableRows;

      let clickActual = `Click dispatched successfully on "${target.value || target.name || 'control'}"`;
      let isDeadClick = false;

      if (isUrlChanged) {
        clickActual = `Clicked "${target.value || target.name || 'control'}" and navigated to "${postClickUrl}"`;
      } else if (isNotificationShown) {
        clickActual = `Clicked "${target.value || target.name || 'control'}". Observed update: "${postClickSnapshot.notification}"`;
      } else if (!isDomChanged) {
        // Delayed state update check (up to 500ms)
        await page.waitForTimeout(500);
        const delayedSnapshot = await page
          .evaluate(() => {
            const el = document.querySelector(
              '[role="status"], [role="alert"], .alert, .modal, .toast, .confirmation, [aria-live="polite"], .cart-count, [data-testid="cart-badge"]'
            );
            const notification =
              el && el.offsetWidth > 0 && el.offsetHeight > 0
                ? (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
                : null;
            return {
              textLength: (document.body?.innerText || '').length,
              domCount: document.querySelectorAll('*').length,
              tableRows: document.querySelectorAll('tr, li, [role="row"]').length,
              notification,
            };
          })
          .catch(() => null);

        const isDelayedChanged =
          delayedSnapshot &&
          (Boolean(delayedSnapshot.notification) ||
            Math.abs(delayedSnapshot.textLength - preClickSnapshot.textLength) > 0 ||
            delayedSnapshot.domCount !== preClickSnapshot.domCount ||
            delayedSnapshot.tableRows !== preClickSnapshot.tableRows);

        if (isDelayedChanged) {
          clickActual = delayedSnapshot.notification
            ? `Clicked "${target.value || target.name || 'control'}". Observed update: "${delayedSnapshot.notification}"`
            : `Clicked "${target.value || target.name || 'control'}" and verified state update.`;
        } else {
          // Action Recovery: re-evaluate the target control within its component and attempt alternative dispatch
          isDeadClick = true;
          try {
            const recoveryHandle = await locator
              .evaluateHandle((el) => {
                // If el is an icon/span/svg or wrapper inside a button, find the button
                const btn = el.closest(
                  'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
                );
                if (btn && btn !== el) return btn;

                // If el is a component or container, find the primary interactive button inside it
                const innerActive = el.querySelector('button, [role="button"], a');
                if (innerActive && innerActive !== el) return innerActive;

                return null;
              })
              .catch(() => null);

            const altEl = recoveryHandle?.asElement();
            if (altEl) {
              console.log('[Action Recovery]: Retrying click on alternative interactive control inside component...');
              await altEl.click({ timeout: 2000, force: true }).catch(() => {});
              await page.waitForTimeout(400);

              const recPostUrl = page.url();
              const recSnapshot = await page
                .evaluate(() => {
                  const el = document.querySelector(
                    '[role="status"], [role="alert"], .alert, .modal, .toast, .confirmation, [aria-live="polite"]'
                  );
                  const notification =
                    el && el.offsetWidth > 0 && el.offsetHeight > 0
                      ? (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
                      : null;
                  return {
                    textLength: (document.body?.innerText || '').length,
                    domCount: document.querySelectorAll('*').length,
                    notification,
                  };
                })
                .catch(() => null);

              const isRecChanged =
                recPostUrl !== preClickUrl ||
                Boolean(recSnapshot?.notification) ||
                Math.abs((recSnapshot?.textLength || 0) - preClickSnapshot.textLength) > 0;

              if (isRecChanged) {
                isDeadClick = false;
                clickActual = `Click recovered: alternative locator dispatched on control within component and produced observable update${
                  recSnapshot?.notification ? `: "${recSnapshot.notification}"` : '.'
                }`;
              }
            }
          } catch (_) {}

          if (isDeadClick) {
            clickActual = `Click dispatched on "${target.value || target.name || 'control'}" but produced no observable functional change (no-op/dead click). Action recovery re-evaluated component controls but observed no state transition.`;
          }
        }
      }

      return { actual: clickActual, isDeadClick };
    }

    case 'fill': {
      const locator = await resolveAgentLocator(page, target, timeout, decision, context);

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

      const rawVal = String(value !== undefined && value !== null ? value : '');
      const thoughtStr = String(decision?.thought || action?.thought || '').toLowerCase();
      const objBehavior = String(context.objective?.targetBehavior || '').toLowerCase();
      const objDesc = String(context.objective?.description || '').toLowerCase();

      const isUsernameKeyword = (str) =>
        /email|e-mail|username|user|login|identifier|account|uname|uid/i.test(str || '');

      const isUsername =
        !isPassword &&
        (
          elemType === 'email' ||
          elemAutocomplete === 'username' ||
          elemAutocomplete === 'email' ||
          isUsernameKeyword(elemName) ||
          isUsernameKeyword(elemPlaceholder) ||
          isUsernameKeyword(elemAriaLabel) ||
          isUsernameKeyword(elemId) ||
          isUsernameKeyword(targetStr) ||
          /\b(fill|enter|input|type)\b.*(email|username|login|credential)/i.test(thoughtStr)
        );

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
        /^(?:invalid|wrong|incorrect|bad_user|fake_user|test_wrong|fail_user|dummy|nonexistent)/i.test(rawVal);

      // Check whether thought explicitly indicates an intent to test valid credentials or log in
      const hasValidIntent =
        /\b(valid|correct|real|supplied|user\s*cred|test\s*cred|account\s*cred|actual\s*cred|log\s*in|sign\s*in|authenticate|access\s*dashboard|proceed\s*with|then\s*login|now\s*login)\b/i.test(
          thoughtStr
        );

      // Check whether thought explicitly indicates deliberate testing of invalid/rejected credentials
      const hasInvalidRejectionIntent =
        (/\b(test|verify|assert|check|observe)\b.*(rejection|denied|failure|invalid\s*login)/i.test(thoughtStr) ||
          /\b(fill|enter|input|type|submit)\b.*(invalid|wrong|incorrect|fake|bad)\b.*(cred|user|email|pass|login)/i.test(
            thoughtStr
          )) &&
        !hasValidIntent;

      // An objective is strictly invalid-only only if it tests invalid credentials AND does NOT test valid login
      const isInvalidOnlyObj =
        isLoginVerificationObjective(context.objective) &&
        requiresValidCredentials(context.objective) === false &&
        /\b(invalid|wrong|rejection|denied)\b/i.test(`${objBehavior} ${objDesc}`);

      const isDeliberateInvalidIntent =
        !isPlaceholderToken &&
        (isDeliberateInvalidValue || hasInvalidRejectionIntent || (isInvalidOnlyObj && !hasValidIntent));

      let textToFill;
      let displayValue;

      if (isPassword) {
        if (isDeliberateInvalidIntent) {
          textToFill = rawVal && /invalid|wrong|fake|bad|incorrect/i.test(rawVal) ? rawVal : 'wrong_password';
          displayValue = '•••••••• (invalid test password)';
        } else {
          // Exact preservation: AI model must NEVER overwrite, truncate or regenerate supplied password
          textToFill = context.credentials?.password || rawVal;
          displayValue = '••••••••';
        }
      } else if (isUsername) {
        if (isDeliberateInvalidIntent) {
          // In deliberate invalid tests, never fill valid credentials or ambiguous truncated tokens
          if (rawVal && /invalid|wrong|fake|bad|incorrect/i.test(rawVal)) {
            if (elemType === 'email' && !rawVal.includes('@')) {
              textToFill = `${rawVal}@example.com`;
            } else {
              textToFill = rawVal;
            }
          } else {
            textToFill = 'invalid_user@example.com';
          }
          displayValue = `"${textToFill}"`;
        } else {
          // Check if rawVal is a placeholder or attempted match for the supplied credentials
          const isPlaceholder =
            rawVal === '[VALID_USERNAME]' ||
            rawVal === '' ||
            rawVal === '""' ||
            rawVal === "''" ||
            rawVal === '[VALID_USER]';

          const suppliedUser = context.credentials?.username || '';
          const isAttemptedSuppliedMatch =
            Boolean(suppliedUser) &&
            (rawVal.toLowerCase() === suppliedUser.toLowerCase() ||
              (suppliedUser.includes('@') && rawVal.toLowerCase() === suppliedUser.split('@')[0].toLowerCase()) ||
              (rawVal.length < suppliedUser.length && suppliedUser.toLowerCase().startsWith(rawVal.toLowerCase())));

          if (suppliedUser && (isPlaceholder || isAttemptedSuppliedMatch || hasValidIntent)) {
            // If the action explicitly targets an alternative test user (e.g. problem_user, locked_out_user)
            // that is distinctly different from the supplied user, preserve the intended test user!
            const isDistinctAlternativeUser =
              Boolean(rawVal) &&
              !isPlaceholder &&
              rawVal.toLowerCase() !== suppliedUser.toLowerCase() &&
              !isAttemptedSuppliedMatch;

            if (isDistinctAlternativeUser) {
              textToFill = rawVal;
            } else {
              // Exact preservation: AI model must NEVER overwrite, truncate or regenerate supplied username/email
              textToFill = suppliedUser;
            }
          } else {
            textToFill = rawVal || suppliedUser || 'user@example.com';
          }
          displayValue = `"${textToFill}"`;
        }
      } else {
        textToFill = rawVal;
        displayValue = `"${rawVal}"`;
      }

      if (isUsername) {
        const isExactMatch = Boolean(context.credentials?.username && textToFill === context.credentials.username);
        console.log(`[Credential Fill Trace] isUsername=true, deliberateInvalid=${isDeliberateInvalidIntent}, modelValue="${rawVal}", textToFillMatchesSuppliedEmail=${isExactMatch}`);
      }

      await locator.fill(textToFill, { timeout });
      return { actual: `Filled input with ${displayValue}` };
    }

    case 'select': {
      const locator = await resolveAgentLocator(page, target, timeout, decision, context);
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
      const locator = await resolveAgentLocator(page, target, timeout, decision, context);
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        const err = new Error(`Element matching "${target.value}" is not visible on page.`);
        err.statusType = 'FAIL';
        throw err;
      }
      return { actual: `Element matching "${target.value}" is visible` };
    }

    case 'assertText': {
      const locator = await resolveAgentLocator(page, target, timeout, decision, context);
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
 * Resolves a locator using accessible roles, labels, text, or CSS with
 * generic discovery and multi-tier recovery when primary matching fails.
 */
async function resolveAgentLocator(page, target, timeout, decision = null, context = null) {
  if (!target) throw new Error('Action decision missing target specification.');
  const { strategy, value, name } = target;

  const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Disambiguation helper for multiple visible matching candidates using generic browser semantics
  const disambiguateCandidates = async (candidateLocators, label, strat) => {
    if (candidateLocators.length === 1) {
      return candidateLocators[0];
    }
    if (candidateLocators.length === 0) {
      return null;
    }

    const action = String(decision?.action || '').toLowerCase();
    const thoughtStr = String(decision?.thought || '').toLowerCase();
    const targetStr = `${target?.strategy || ''} ${target?.value || ''} ${target?.name || ''}`.toLowerCase();
    const expectedStr = String(decision?.expectedOutcome || '').toLowerCase();
    const objBehavior = String(context?.objective?.targetBehavior || '').toLowerCase();
    const objDesc = String(context?.objective?.description || '').toLowerCase();
    const combinedIntent = `${thoughtStr} ${targetStr} ${expectedStr} ${objBehavior} ${objDesc}`.toLowerCase();

    // Contextual intent classification using generic semantic tokens
    const isSubmitIntent =
      /\b(submit|log[-_\s]*in|sign[-_\s]*in|register|sign[-_\s]*up|create\s*account|confirm|checkout|place\s*order|save|save\s*changes|apply|apply\s*now|book|book\s*now)\b/i.test(
        combinedIntent
      );
    const isNavigationIntent =
      (/\b(navigat|go\s*to|open|view|visit|link|tab|menu|footer|header|home|browse|explore|portal|page|item\s*details|view\s*cart)\b/i.test(
        combinedIntent
      ) ||
        target?.strategy === 'link' ||
        target?.value === 'link') &&
      !isSubmitIntent;
    const isFillIntent = action === 'fill' || /\b(fill|type|enter|input|write)\b/i.test(combinedIntent);
    const isSelectIntent = action === 'select' || /\b(select|choose|pick|option|dropdown)\b/i.test(combinedIntent);

    // Extract entity phrases for contextual component association
    const entityPhrases = [];
    if (target?.context) {
      entityPhrases.push(String(target.context).trim().toLowerCase());
    }
    const rawThought = String(decision?.thought || '');
    const quotedInThought = rawThought.match(/['"]([^'"]{2,50})['"]/g);
    if (quotedInThought) {
      for (const q of quotedInThought) {
        const clean = q.replace(/^['"]|['"]$/g, '').trim().toLowerCase();
        if (clean && clean !== String(target?.value || '').toLowerCase()) {
          entityPhrases.push(clean);
        }
      }
    }
    const rawTargetStr = `${target?.value || ''} ${target?.name || ''}`.toLowerCase();
    const entityContextClues = `${decision?.thought || ''} ${decision?.expectedOutcome || ''} ${context?.objective?.targetBehavior || ''}`;
    const forMatch = entityContextClues.match(
      /\b(?:for|on|in|of|item|product|card|row)\s+([A-Za-z0-9][A-Za-z0-9_\-\s]{2,40})/i
    );
    if (forMatch && forMatch[1]) {
      const phrase = forMatch[1].trim().toLowerCase();
      if (!phrase.includes(rawTargetStr)) {
        entityPhrases.push(phrase);
      }
    }

    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'click', 'button', 'select', 'test', 'verify',
      'page', 'should', 'will', 'have', 'been', 'user', 'action', 'element', 'control', 'role', 'text'
    ]);
    const keywords = combinedIntent
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    // Evaluate semantic profile and container context for each candidate
    const scored = [];
    for (let i = 0; i < candidateLocators.length; i++) {
      const loc = candidateLocators[i];
      const meta = await loc
        .evaluate((el) => {
          const tagName = el.tagName.toLowerCase();
          const explicitRole = (el.getAttribute('role') || '').toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          const isHeading = /^h[1-6]$/.test(tagName) || explicitRole === 'heading';
          const isButton =
            tagName === 'button' ||
            explicitRole === 'button' ||
            type === 'submit' ||
            type === 'button';
          const inForm = Boolean(el.form || el.closest('form'));
          const isSubmitBtn = type === 'submit' || (isButton && inForm);
          const isLink =
            tagName === 'a' ||
            explicitRole === 'link' ||
            explicitRole === 'tab' ||
            explicitRole === 'menuitem';
          const isInput =
            tagName === 'input' ||
            tagName === 'textarea' ||
            explicitRole === 'textbox' ||
            el.isContentEditable;
          const isSelect =
            tagName === 'select' ||
            explicitRole === 'combobox' ||
            explicitRole === 'listbox';
          const isStaticText =
            ['p', 'span', 'label', 'legend', 'b', 'strong', 'i', 'em', 'small', 'caption'].includes(tagName) &&
            !explicitRole;
          const hasClickPointer = window.getComputedStyle(el).cursor === 'pointer';
          const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();

          const controlText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();

          // Generic repeated component selectors
          const explicitSelector =
            'tr, article, section, li, figure, details, dialog, form, fieldset, [role="row"], [role="article"], [role="listitem"], [role="region"], [role="group"], [class*="card" i], [class*="item" i], [class*="row" i], [class*="product" i], [class*="tile" i], [class*="box" i], [class*="panel" i], [class*="entry" i], [class*="result" i], [class*="listing" i], [class*="record" i], [class*="accessory" i], [class*="addon" i], [class*="nested" i], [class*="component" i], [class*="option" i], [class*="offer" i], [data-testid*="card" i], [data-testid*="item" i], [data-testid*="row" i]';

          // Ascend ancestors to find the closest component container that holds a heading or distinct semantic content
          let container = null;
          let curr = el.parentElement;
          while (curr && curr !== document.body && curr !== document.documentElement) {
            const isExplicit = curr.matches && curr.matches(explicitSelector);
            const hasHeadings = Boolean(curr.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]'));
            const currText = (curr.innerText || curr.textContent || '').trim().replace(/\s+/g, ' ');
            const textDiff = currText.toLowerCase().replace(controlText, '').trim();

            if (isExplicit || (hasHeadings && textDiff.length > 5)) {
              container = curr;
              break;
            }
            curr = curr.parentElement;
          }

          if (!container) {
            container = el.closest('tr, article, section, li, form, fieldset, div') || el.parentElement;
          }

          const containerText = container
            ? (container.innerText || container.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase()
            : '';

          return {
            tagName,
            role: explicitRole,
            type,
            isHeading,
            isButton,
            isSubmitBtn,
            isLink,
            isInput,
            isSelect,
            isStaticText,
            hasClickPointer,
            inForm,
            ariaLabel,
            containerText,
          };
        })
        .catch(() => null);

      if (!meta) continue;

      let semanticScore = 0;

      if (action === 'click') {
        // Exclude / heavily penalize non-interactive headings and static text for click actions
        if (meta.isHeading) {
          semanticScore -= 500;
        } else if (meta.isStaticText && !meta.hasClickPointer) {
          semanticScore -= 200;
        }

        if (isSubmitIntent) {
          if (meta.isSubmitBtn) semanticScore += 300;
          else if (meta.isButton) semanticScore += 200;
          else if (meta.isLink) semanticScore += 60;
        } else if (isNavigationIntent) {
          if (meta.isLink) semanticScore += 300;
          else if (meta.isButton) semanticScore += 120;
        } else {
          // General click action: prioritize interactive controls
          if (meta.isButton) semanticScore += 200;
          else if (meta.isLink) semanticScore += 180;
          else if (meta.hasClickPointer) semanticScore += 60;
        }

        if (meta.ariaLabel) {
          semanticScore += 20;
        }
      } else if (action === 'fill') {
        if (meta.isInput) semanticScore += 300;
        else semanticScore -= 500;
      } else if (action === 'select') {
        if (meta.isSelect) semanticScore += 300;
        else semanticScore -= 500;
      }

      // Container contextual score
      let containerScore = 0;
      if (meta.containerText.length > 0) {
        // 1. Full entity phrase matches (+80 per phrase match)
        for (const ep of entityPhrases) {
          if (meta.containerText.includes(ep)) {
            containerScore += 80;
          }
        }

        // 2. Keyword matches (+15 per keyword match)
        if (keywords.length > 0) {
          for (const kw of keywords) {
            if (meta.containerText.includes(kw)) {
              containerScore += 15;
            }
          }
        }

        // 3. Positional tie-breaker if user requested "first" / "top" result and this is candidate 0
        if (i === 0 && /\b(first|1st|top)\s*(result|item|product|match)?\b/i.test(combinedIntent)) {
          containerScore += 5;
        }
      }

      const totalScore = semanticScore + containerScore;

      scored.push({
        loc,
        totalScore,
        semanticScore,
        containerScore,
        meta,
        snippet: meta.containerText.slice(0, 80),
      });
    }

    if (scored.length === 0) return null;

    scored.sort((a, b) => b.totalScore - a.totalScore);

    // If top candidate has a strictly higher score than second candidate:
    if (scored.length === 1 || scored[0].totalScore > scored[1].totalScore) {
      if (scored[0].totalScore > -100) {
        console.log(
          `[Locator Disambiguation]: Selected <${scored[0].meta.tagName}> matching "${label}" (totalScore: ${scored[0].totalScore}, semantic: ${scored[0].semanticScore}, container: ${scored[0].containerScore}).`
        );
        return scored[0].loc;
      }
    }

    // Genuine unresolved ambiguity remains: multiple candidates tied or no valid candidate
    const ambigErr = new Error(
      `Ambiguous controls: Found ${candidateLocators.length} identical visible controls matching "${label}" (strategy: ${strat}). Cannot determine intended target without additional context.`
    );
    ambigErr.isAmbiguous = true;
    ambigErr.statusType = 'BLOCKED';
    throw ambigErr;
  };

  const checkAndDisambiguate = async (loc, label, strat) => {
    const cnt = await loc.count().catch(() => 0);
    if (cnt === 1) {
      if (await loc.first().isVisible({ timeout: 800 }).catch(() => false)) {
        return loc.first();
      }
    } else if (cnt > 1) {
      const vis = [];
      for (let i = 0; i < cnt; i++) {
        const nth = loc.nth(i);
        if (await nth.isVisible({ timeout: 400 }).catch(() => false)) {
          vis.push(nth);
        }
      }
      if (vis.length > 0) {
        return await disambiguateCandidates(vis, label, strat);
      }
    }
    return null;
  };

  // Helper to build primary locator
  const buildPrimaryLocator = (strat, val, nm) => {
    switch (strat) {
      case 'role': {
        if (nm) {
          return page.getByRole(val, { name: nm });
        }
        return page.getByRole(val);
      }
      case 'label':
        return page.getByLabel(val);
      case 'placeholder':
        return page.getByPlaceholder(val);
      case 'text': {
        return page.getByText(val);
      }
      case 'name': {
        const escaped = String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return page.locator(`[name="${escaped}"]`);
      }
      case 'id': {
        const escaped = String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return page.locator(`[id="${escaped}"]`);
      }
      case 'css':
      default:
        return page.locator(val);
    }
  };

  // Phase 4.9: Top-Down Component-Scoped Locator Resolution
  const scopedEntityPhrases = [];
  if (target?.context) {
    scopedEntityPhrases.push(String(target.context).trim());
  }
  const rawThought = String(decision?.thought || '');
  const quotedInThought = rawThought.match(/['"]([^'"]{2,50})['"]/g);
  if (quotedInThought) {
    for (const q of quotedInThought) {
      const clean = q.replace(/^['"]|['"]$/g, '').trim();
      if (clean && clean.toLowerCase() !== String(value || '').toLowerCase()) {
        scopedEntityPhrases.push(clean);
      }
    }
  }
  const forMatch = rawThought.match(
    /\b(?:for|on|in|of|item|product|card|row)\s+([A-Za-z0-9][A-Za-z0-9_\-\s]{2,40})/i
  );
  if (forMatch && forMatch[1]) {
    const clean = forMatch[1].trim();
    if (!clean.toLowerCase().includes(String(value || '').toLowerCase())) {
      scopedEntityPhrases.push(clean);
    }
  }

  if (scopedEntityPhrases.length > 0) {
    const componentSelector =
      'tr, article, section, li, figure, details, dialog, form, fieldset, [role="row"], [role="article"], [role="listitem"], [role="region"], [role="group"], [class*="card" i], [class*="item" i], [class*="row" i], [class*="product" i], [class*="tile" i], [class*="box" i], [class*="panel" i], [class*="entry" i], [class*="result" i], [class*="listing" i], [class*="record" i], [class*="accessory" i], [class*="addon" i], [class*="nested" i], [class*="component" i], [class*="option" i], [class*="offer" i], [data-testid*="card" i], [data-testid*="item" i], [data-testid*="row" i]';

    for (const phrase of scopedEntityPhrases) {
      const escPhrase = escapeRegex(phrase);
      const compMatches = page.locator(componentSelector).filter({ hasText: new RegExp(escPhrase, 'i') });
      const compCount = await compMatches.count().catch(() => 0);
      if (compCount >= 1) {
        // If nested matching components exist, choose the most specific (innermost) component
        let comp = compMatches.first();
        if (compCount > 1) {
          let minLen = Infinity;
          for (let c = 0; c < compCount; c++) {
            const candidateComp = compMatches.nth(c);
            const textLen = await candidateComp
              .evaluate((el) => (el.innerText || el.textContent || '').trim().length)
              .catch(() => Infinity);
            if (textLen < minLen) {
              minLen = textLen;
              comp = candidateComp;
            }
          }
        }

        if (await comp.isVisible({ timeout: 500 }).catch(() => false)) {
          const scopedControl = comp.locator(buildPrimaryLocator(strategy, value, name));
          const scopedCount = await scopedControl.count().catch(() => 0);
          if (scopedCount === 1) {
            if (await scopedControl.first().isVisible({ timeout: 500 }).catch(() => false)) {
              console.log(
                `[Component Scoping]: Resolved control "${value || name}" scoped within component matching "${phrase}".`
              );
              return scopedControl.first();
            }
          } else if (scopedCount > 1) {
            const scopedCandidates = [];
            for (let s = 0; s < scopedCount; s++) {
              const sc = scopedControl.nth(s);
              if (await sc.isVisible({ timeout: 300 }).catch(() => false)) {
                scopedCandidates.push(sc);
              }
            }
            if (scopedCandidates.length > 0) {
              return await disambiguateCandidates(scopedCandidates, name || value, strategy);
            }
          }
        }
      }
    }
  }

  const primaryLocator = buildPrimaryLocator(strategy, value, name);

  // 1. Primary fast attempt (up to 2500ms or remaining timeout)
  const primaryWaitMs = Math.min(timeout, 2500);
  try {
    const action = String(decision?.action || '').toLowerCase();
    const locatorsToInspect = [primaryLocator];

    // For click actions using text strategy, also include accessible interactive controls matching name/aria-label/title
    if (action === 'click' && strategy === 'text' && value) {
      const escVal = escapeRegex(value);
      const safeVal = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      locatorsToInspect.push(
        page.getByRole('button', { name: new RegExp(`^${escVal}$`, 'i') }),
        page.getByRole('link', { name: new RegExp(`^${escVal}$`, 'i') }),
        page.locator(
          `button[aria-label="${safeVal}" i], button[title="${safeVal}" i], a[aria-label="${safeVal}" i], a[title="${safeVal}" i], [role="button"][aria-label="${safeVal}" i], [role="button"][title="${safeVal}" i]`
        )
      );
    }

    const uniqueCandidates = [];
    const seenDomIds = new Set();

    for (const loc of locatorsToInspect) {
      const cnt = await loc.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const item = loc.nth(i);
        const isVis = await item.isVisible({ timeout: 400 }).catch(() => false);
        if (!isVis) continue;
        const domId = await item
          .evaluate((el) => {
            if (!el.__testit_cand_id) {
              el.__testit_cand_id = Math.random().toString(36).slice(2);
            }
            return el.__testit_cand_id;
          })
          .catch(() => null);
        if (domId && !seenDomIds.has(domId)) {
          seenDomIds.add(domId);
          uniqueCandidates.push(item);
        }
      }
    }

    if (uniqueCandidates.length === 1) {
      const isPrimaryVis = await uniqueCandidates[0].isVisible({ timeout: primaryWaitMs }).catch(() => false);
      if (isPrimaryVis) {
        return uniqueCandidates[0];
      }
    } else if (uniqueCandidates.length > 1) {
      return await disambiguateCandidates(uniqueCandidates, name || value, strategy);
    }
  } catch (err) {
    if (err.isAmbiguous) throw err;
    // Proceed to generic recovery
  }

  // 2. Generic Locator Discovery and Recovery
  const targetLabel = name || value || '';
  const cleanLabel = String(targetLabel).replace(/[^\p{L}\p{N}\s_\-]/gu, '').trim();
  const candidateKeywords = [cleanLabel, targetLabel]
    .filter(Boolean)
    .filter((w) => w.length >= 2);

  // 2A. Role-based recovery: Case-insensitive / substring / cross-role discovery
  if (strategy === 'role' && candidateKeywords.length > 0) {
    for (const kw of candidateKeywords) {
      // Try regex name match on the same role
      const regexRole = page.getByRole(value, { name: new RegExp(escapeRegex(kw), 'i') });
      const recRole = await checkAndDisambiguate(regexRole, kw, value);
      if (recRole) {
        console.log(`[Locator Recovery]: Recovered element with role "${value}" matching "${kw}".`);
        return recRole;
      }

      // Cross-role discovery (e.g. model guessed link but element is button, or vice-versa)
      const altRoles = value === 'link' ? ['button', 'tab'] : value === 'button' ? ['link', 'tab'] : ['button', 'link'];
      for (const altRole of altRoles) {
        const altRoleLoc = page.getByRole(altRole, { name: new RegExp(escapeRegex(kw), 'i') });
        const recAlt = await checkAndDisambiguate(altRoleLoc, kw, altRole);
        if (recAlt) {
          console.log(`[Locator Recovery]: Recovered cross-role element with role "${altRole}" matching "${kw}".`);
          return recAlt;
        }
      }

      // Match interactive controls (button, a, role=button) containing text or aria-label
      const interactiveMatch = page
        .locator('button, a, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"]')
        .filter({ hasText: new RegExp(escapeRegex(kw), 'i') });
      const recInt = await checkAndDisambiguate(interactiveMatch, kw, 'interactive');
      if (recInt) {
        console.log(`[Locator Recovery]: Recovered interactive element with text matching "${kw}".`);
        return recInt;
      }
    }
  }

  // 2B. Text-based recovery
  if (strategy === 'text' && value) {
    const textRegex = page.getByText(new RegExp(escapeRegex(cleanLabel || value), 'i'));
    const recText = await checkAndDisambiguate(textRegex, cleanLabel || value, 'text');
    if (recText) {
      console.log(`[Locator Recovery]: Recovered text element via case-insensitive matching: "${cleanLabel || value}".`);
      return recText;
    }

    const textSubLoc = page
      .locator('button, a, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"]')
      .filter({ hasText: new RegExp(escapeRegex(cleanLabel || value), 'i') });
    const recSub = await checkAndDisambiguate(textSubLoc, cleanLabel || value, 'interactive-text');
    if (recSub) {
      console.log(`[Locator Recovery]: Recovered text element via interactive substring matching: "${cleanLabel || value}".`);
      return recSub;
    }

    const ariaMatch = page.locator(`[aria-label*="${cleanLabel || value}" i], [title*="${cleanLabel || value}" i]`);
    const recAria = await checkAndDisambiguate(ariaMatch, cleanLabel || value, 'aria-label');
    if (recAria) {
      console.log(`[Locator Recovery]: Recovered text element via aria-label/title: "${cleanLabel || value}".`);
      return recAria;
    }
  }

  // 2C. CSS-based recovery (extract text query from :has-text or :text)
  if (strategy === 'css' && value) {
    const textInCss = value.match(/:(?:has-text|text)\(['"]?([^'")]+)['"]?\)/i);
    if (textInCss && textInCss[1]) {
      const extractedText = textInCss[1].trim();
      const cssRecovered = page
        .locator('button, a, [role="button"], [role="link"]')
        .filter({ hasText: new RegExp(escapeRegex(extractedText), 'i') });
      const recCss = await checkAndDisambiguate(cssRecovered, extractedText, 'css');
      if (recCss) {
        console.log(`[Locator Recovery]: Recovered CSS element via extracted text query "${extractedText}".`);
        return recCss;
      }
    }
  }

  // 2D. Semantic live DOM inspection & intent-driven recovery
  try {
    const liveControls = await page.evaluate(() => {
      const isVis = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
      const els = Array.from(
        document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]'
        )
      );
      return els.filter(isVis).map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        ariaLabel: (el.getAttribute('aria-label') || '').trim(),
        title: (el.getAttribute('title') || '').trim(),
        placeholder: (el.getAttribute('placeholder') || '').trim(),
        id: el.id || '',
        href: el.getAttribute('href') || '',
        type: el.getAttribute('type') || '',
      }));
    });

    if (Array.isArray(liveControls) && liveControls.length > 0) {
      // Find candidate control with highest semantic relevance to target/thought
      const semanticCandidates = liveControls.filter((ctrl) => {
        const ctrlText = `${ctrl.text} ${ctrl.ariaLabel} ${ctrl.title} ${ctrl.placeholder} ${ctrl.href}`.toLowerCase();
        return candidateKeywords.some((kw) => ctrlText.includes(kw.toLowerCase()));
      });

      if (semanticCandidates.length > 0) {
        const best = semanticCandidates[0];
        let recoveredLoc = null;
        if (best.id) {
          recoveredLoc = page.locator(`#${best.id}`);
        } else if (best.ariaLabel) {
          recoveredLoc = page.locator(`[aria-label="${best.ariaLabel}"]`);
        } else if (best.href) {
          recoveredLoc = page.locator(`a[href="${best.href}"]`);
        } else if (best.text) {
          recoveredLoc = page.getByText(best.text, { exact: true });
        }

        if (recoveredLoc && (await recoveredLoc.first().isVisible({ timeout: 800 }).catch(() => false))) {
          console.log(`[Locator Recovery]: Dynamically recovered control <${best.tag}> with text="${best.text || best.ariaLabel}".`);
          return recoveredLoc.first();
        }
      }
    }
  } catch {
    // Non-fatal if page evaluation fails
  }

  // 3. Final attempt with primary locator or report genuine failure
  const remainingWaitMs = Math.max(1000, Math.min(timeout - primaryWaitMs, 3000));
  const finalCheck = await primaryLocator.first().isVisible({ timeout: remainingWaitMs }).catch(() => false);
  if (finalCheck) {
    return primaryLocator.first();
  }

  const notFoundErr = new Error(
    `Element matching "${name || value}" (strategy: ${strategy}) could not be located on the page after inspecting live roles, accessible names, and visible controls.`
  );
  notFoundErr.statusType = 'FAIL';
  throw notFoundErr;
}

/**
 * Detects whether the model's reasoning/thought and its action value contradict each other.
 * If safe repair is possible (e.g. thought clearly specified intended test user), repairs decision.value.
 * If repair fails or intent is conflicting, returns a structured error.
 *
 * @param {object} decision
 * @param {object} [context]
 * @returns {{ valid: boolean, repaired?: boolean, mismatch?: boolean, error?: string, details?: object }}
 */
export function detectActionReasoningMismatch(decision, context = {}) {
  if (!decision || typeof decision !== 'object') return { valid: true };
  if (decision.action !== 'fill') return { valid: true };

  const thought = String(decision.thought || '').trim();
  const rawValue = String(decision.value !== undefined && decision.value !== null ? decision.value : '').trim();
  if (!thought) return { valid: true };

  // Check if thought explicitly states an intention to fill a specific username or credential
  const quotedMatches = thought.match(/['"]([a-zA-Z0-9_\-\.\@]{3,40})['"]/g);
  let explicitIntendedVal = null;
  if (quotedMatches) {
    for (const q of quotedMatches) {
      const clean = q.replace(/^['"]|['"]$/g, '').trim();
      if (
        !/^(?:email|username|user|password|login|text|input|value|button|submit|click|placeholder|selector|id|name|form|field|patient|contact|phone|data)$/i.test(
          clean
        )
      ) {
        explicitIntendedVal = clean;
        break;
      }
    }
  }

  if (!explicitIntendedVal) {
    const valueMatch = thought.match(
      /\b(?:with|as|value|named|account)\s+['"]?([a-zA-Z0-9_\-\.\@]{3,30})['"]?\b/i
    );
    if (valueMatch && valueMatch[1]) {
      const cand = valueMatch[1].trim();
      if (
        !/^(?:the|into|with|field|input|box|form|valid|invalid|credentials?|login|username|password|patient|contact|phone|email|name|data|text|value|search|query|details)$/i.test(
          cand
        )
      ) {
        explicitIntendedVal = cand;
      }
    }
  }

  if (explicitIntendedVal) {
    // If thought explicitly specifies an intended test value (like "problem_user")
    // but action value has a different value (e.g. "[VALID_USERNAME]" or "standard_user")
    if (rawValue.toLowerCase() !== explicitIntendedVal.toLowerCase()) {
      const originalValue = rawValue;
      decision.value = explicitIntendedVal;
      return {
        valid: true,
        repaired: true,
        mismatch: true,
        details: {
          intendedFromReasoning: explicitIntendedVal,
          actionValue: originalValue,
          repairedTo: explicitIntendedVal,
          reason: `Model reasoning specifically intended to enter "${explicitIntendedVal}", but action value was "${originalValue}". Repaired action value to match explicit reasoning intent.`,
        },
      };
    }
  }

  return { valid: true };
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

  const isAuthTerm = /\b(log[-_\s]*in|sign[-_\s]*in|logging[-_\s]*in|authenticate|authentication|auth[-_\s]*flow|login[-_\s]*page|signin[-_\s]*page|credentials|allows?\s*access|denies?\s*access)\b/i.test(text);
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
    /\b(valid|supplied|provided|correct|authorized|legitimate|account)\s*(?:logins?|credentials?|users?|accounts?|passwords?)\b/i.test(combined) ||
    /\b(successful\s*(?:logins?|authentications?|sign[-_\s]*ins?)|allows?\s*access|grants?\s*access|authenticates?\s*successfully|log\s*in\s*successfully)\b/i.test(combined) ||
    /\b(valid\s*and\s*invalid|valid\s*&\s*invalid|both\s*valid|log\s*in\s*with\s*valid|sign\s*in\s*with\s*valid|using\s*valid|submit\s*valid|allows?\s*access\s*with\s*valid|access\s*with\s*valid)\b/i.test(combined) ||
    /\b(valid\s*credentials?|valid\s*logins?|test\s*credentials?|account\s*credentials?)\b/i.test(preconds);

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
    if (!isPassVisible) {
      executionSteps.push({
        stepIndex,
        objectiveId: objId,
        action: 'restoreSession',
        description: 'Attempt to restore authenticated session using supplied test credentials',
        status: 'FAIL',
        durationMs: Date.now() - startMs,
        expected: 'Password input field visible on login form',
        actual: 'Session restoration failed: No password input field visible on page to restore authentication',
        screenshot: await captureSafeScreenshot(page),
      });
      return false;
    }

    const userInput = page.locator('input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="email" i], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[placeholder*="user" i], input[placeholder*="email" i], input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])').first();
    const isUserVisible = await userInput.isVisible({ timeout: 2500 }).catch(() => false);
    if (!isUserVisible) {
      executionSteps.push({
        stepIndex,
        objectiveId: objId,
        action: 'restoreSession',
        description: 'Attempt to restore authenticated session using supplied test credentials',
        status: 'FAIL',
        durationMs: Date.now() - startMs,
        expected: 'Username/email input field visible on login form',
        actual: 'Session restoration failed: No username/email input field visible on page to restore authentication',
        screenshot: await captureSafeScreenshot(page),
      });
      return false;
    }

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
export function checkObjectiveDependencies(
  objective,
  { failedObjectiveIds, authFailed, authSucceeded, credentials, plannedObjectives = [] }
) {
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
    if (failedObjectiveIds && failedObjectiveIds.has(depId)) {
      const depObj = plannedObjectives.find((o) => (o.id || o.objectiveId) === depId);
      const isDepAuthObjective = depObj ? isLoginVerificationObjective(depObj) : false;
      const isDepInvalidOnly = depObj ? (isLoginVerificationObjective(depObj) && !requiresValidCredentials(depObj)) : false;
      const isCurrentAuthObjective = isLoginVerificationObjective(objective);
      const currentRequiresAuth = requiresAuthenticatedSession(objective);

      // Independent objectives:
      // 1. If prerequisite was an invalid-only login test, it never blocks subsequent independent tests
      if (isDepInvalidOnly) {
        continue;
      }
      // 2. If current objective is an independent login test (testing valid login or another user), it can run independently
      if (isCurrentAuthObjective) {
        continue;
      }
      // 3. If current objective is an independent public flow (does not require auth), it can run independently
      if (!currentRequiresAuth && !isCurrentAuthObjective) {
        continue;
      }

      return {
        canRun: false,
        status: 'SKIPPED',
        reason:
          currentRequiresAuth && isDepAuthObjective
            ? 'Skipped: Requires an authenticated session, but earlier authentication verification failed.'
            : `Skipped: Prerequisite objective "${depId}" failed or was not satisfied.`,
      };
    }
  }

  // 2. Preconditions referencing objective IDs
  if (Array.isArray(objective.preconditions)) {
    for (const p of objective.preconditions) {
      if (typeof p === 'string' && failedObjectiveIds && failedObjectiveIds.has(p)) {
        const depObj = plannedObjectives.find((o) => (o.id || o.objectiveId) === p);
        const isDepAuthObjective = depObj ? isLoginVerificationObjective(depObj) : false;
        const isDepInvalidOnly = depObj ? (isLoginVerificationObjective(depObj) && !requiresValidCredentials(depObj)) : false;
        const isCurrentAuthObjective = isLoginVerificationObjective(objective);
        const currentRequiresAuth = requiresAuthenticatedSession(objective);

        if (isDepInvalidOnly) {
          continue;
        }
        if (isCurrentAuthObjective) {
          continue;
        }
        if (!currentRequiresAuth && !isCurrentAuthObjective) {
          continue;
        }

        return {
          canRun: false,
          status: 'SKIPPED',
          reason:
            currentRequiresAuth && isDepAuthObjective
              ? 'Skipped: Requires an authenticated session, but earlier authentication verification failed.'
              : `Skipped: Prerequisite objective "${p}" failed or was not satisfied.`,
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

