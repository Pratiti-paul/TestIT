/**
 * Presentation logic and failure-report schema resolution for AiTestResults.
 *
 * Ensures seamless compatibility between the backend autonomous agent failure schema
 * ({ description, hypothesis, expected, actual, error, status }) and legacy/deterministic
 * runner schemas ({ stepIndex, action, message, status, expected, actual }), without
 * ever producing undefined, null, or misleading placeholders in the UI.
 */

/**
 * Resolves the overall status banner flags and title.
 *
 * @param {object} report
 * @returns {object}
 */
export function resolveStatusBanner(report) {
  if (!report || typeof report !== 'object') {
    return {
      isPassed: false,
      isBlocked: false,
      isPartial: false,
      isUnsupported: false,
      isError: false,
      isFailed: false,
      hasFailedOrError: false,
      statusTitle: 'AI Website Test',
      statusSubtitle: '',
      durationSec: '0.00',
    };
  }

  const status = String(report.status || '').toLowerCase();
  const isPassed = status === 'passed' || status === 'pass';
  const isBlocked = status === 'blocked';
  const isPartial = status === 'partial';
  const isUnsupported = status === 'unsupported';
  const isError = status === 'error';
  const isFailed = status === 'failed' || status === 'fail';
  const hasFailedOrError = isFailed || isError;

  let statusTitle = 'AI QA Test Outcome';
  if (isPassed) statusTitle = 'Test Passed Successfully';
  else if (isFailed) statusTitle = 'Test Verification Failed';
  else if (isError) statusTitle = 'Test Execution Error';
  else if (isPartial) statusTitle = 'Partial Test Journey Completed';
  else if (isBlocked) statusTitle = 'Test Execution Blocked';
  else if (isUnsupported) statusTitle = 'Clarification / AI Key Required';

  const durationSec = ((report.durationMs || 0) / 1000).toFixed(2);
  const statusSubtitle = report.objective || report.testName || 'AI Website Test';

  return {
    isPassed,
    isBlocked,
    isPartial,
    isUnsupported,
    isError,
    isFailed,
    hasFailedOrError,
    statusTitle,
    statusSubtitle,
    durationSec,
  };
}

/**
 * Resolves AI planner and provider attribution metadata.
 *
 * Accurately distinguishes live AI (Gemini, OpenAI) from MockProvider and deterministic fallback.
 * Mock and deterministic execution are NEVER labeled as live AI or LLM Synthesized.
 *
 * @param {object} planner
 * @returns {object}
 */
export function resolvePlannerAttribution(planner) {
  if (!planner || typeof planner !== 'object') {
    return {
      hasPlanner: false,
      isLiveAi: false,
      plannerTitle: 'Deterministic Fallback Planner',
      plannerBadge: 'Rule-Based Engine',
      notice: null,
    };
  }

  const isLiveAi = Boolean(planner.aiConfigured);
  let plannerTitle = 'Deterministic Fallback Planner';
  let plannerBadge = 'Rule-Based Engine';

  if (planner.aiConfigured) {
    const providerName = planner.provider ? String(planner.provider).toUpperCase() : 'AI';
    const modelName = planner.model ? ` (${planner.model})` : ' (live)';
    plannerTitle = `AI Planner: ${providerName}${modelName}`;
    plannerBadge = 'LLM Synthesized';
  } else if (planner.provider === 'mock') {
    const modelName = planner.model ? ` (${planner.model})` : '';
    plannerTitle = `Mock QA Agent${modelName}`;
    plannerBadge = 'Mock Engine';
  } else if (planner.mode === 'unconfigured' || !planner.provider) {
    plannerTitle = 'AI Provider Not Configured';
    plannerBadge = 'Unconfigured';
  } else {
    plannerTitle = 'Deterministic Fallback Planner';
    plannerBadge = 'Rule-Based Engine';
  }

  return {
    hasPlanner: true,
    isLiveAi,
    plannerTitle,
    plannerBadge,
    notice: planner.notice || null,
  };
}

/**
 * Resolves failure details from backend report failure object.
 *
 * Rules:
 * - Prefer failure.description as the primary message.
 * - Support failure.message as a backward-compatible fallback if older reports use it.
 * - Support failure.error if neither description nor message is present.
 * - Render failure.hypothesis when available.
 * - Render expected and actual values when available.
 * - Render step index and action only when those values genuinely exist.
 * - Never return undefined, null, empty placeholders, or misleading defaults.
 *
 * @param {object} failure - The report.failure object
 * @param {boolean} [isReportError=false] - Whether report.status is 'error'
 * @returns {object | null}
 */
export function resolveFailureDetails(failure, isReportError = false) {
  if (!failure || typeof failure !== 'object') {
    return null;
  }

  const failureStatus = String(failure.status || '').toUpperCase();
  const isFailureAnError = isReportError || failureStatus === 'ERROR';

  const baseHeading = isFailureAnError ? 'Technical Error' : 'Verification Failed';

  const hasStepIndex =
    failure.stepIndex !== undefined &&
    failure.stepIndex !== null &&
    String(failure.stepIndex).trim().length > 0;
  const hasAction =
    typeof failure.action === 'string' && failure.action.trim().length > 0;

  let failureHeading = baseHeading;
  if (hasStepIndex && hasAction) {
    failureHeading = `${baseHeading} at Step ${failure.stepIndex} (${failure.action})`;
  } else if (hasStepIndex) {
    failureHeading = `${baseHeading} at Step ${failure.stepIndex}`;
  } else if (hasAction) {
    failureHeading = `${baseHeading} (${failure.action})`;
  }

  const primaryMessage =
    (typeof failure.description === 'string' && failure.description.trim()) ||
    (typeof failure.message === 'string' && failure.message.trim()) ||
    (typeof failure.error === 'string' && failure.error.trim()) ||
    null;

  const hypothesis =
    typeof failure.hypothesis === 'string' && failure.hypothesis.trim().length > 0
      ? failure.hypothesis.trim()
      : null;

  const hasExpected =
    typeof failure.expected === 'string' && failure.expected.trim().length > 0;
  const hasActual =
    typeof failure.actual === 'string' && failure.actual.trim().length > 0;

  const expected = hasExpected ? failure.expected.trim() : null;
  const actual = hasActual ? failure.actual.trim() : null;

  return {
    failureHeading,
    primaryMessage,
    hypothesis,
    expected,
    actual,
    hasExpected,
    hasActual,
    isFailureAnError,
    stepIndex: hasStepIndex ? failure.stepIndex : null,
    action: hasAction ? failure.action : null,
  };
}

/**
 * Resolves step presentation metrics and styling classes.
 *
 * @param {object} step
 * @returns {object}
 */
export function resolveStepDetails(step) {
  if (!step || typeof step !== 'object') {
    return {
      normStatus: 'UNKNOWN',
      isPass: false,
      isFail: false,
      isBlock: false,
      isErr: false,
      isSkip: false,
      cardClass: 'card-skipped',
      pillClass: 'pill-skipped',
      actualBlockClass: 'actual-skipped',
      hasExpected: false,
      hasActual: false,
      expected: null,
      actual: null,
    };
  }

  const normStatus = String(step.status || '').toUpperCase();
  const isPass = normStatus === 'PASS' || normStatus === 'PASSED';
  const isFail = normStatus === 'FAIL' || normStatus === 'FAILED';
  const isBlock = normStatus === 'BLOCKED';
  const isErr = normStatus === 'ERROR';
  const isSkip = normStatus === 'SKIPPED';

  const cardClass = isPass
    ? 'card-passed'
    : isFail
    ? 'card-failed'
    : isBlock
    ? 'card-blocked'
    : isErr
    ? 'card-error'
    : 'card-skipped';

  const pillClass = isPass
    ? 'pill-passed'
    : isFail
    ? 'pill-failed'
    : isBlock
    ? 'pill-blocked'
    : isErr
    ? 'pill-error'
    : 'pill-skipped';

  const actualBlockClass = isPass
    ? 'actual-passed'
    : isFail
    ? 'actual-failed'
    : isBlock
    ? 'actual-blocked'
    : isErr
    ? 'actual-failed'
    : 'actual-skipped';

  const hasExpected =
    typeof step.expected === 'string' && step.expected.trim().length > 0;
  const hasActual =
    typeof step.actual === 'string' && step.actual.trim().length > 0;

  return {
    normStatus,
    isPass,
    isFail,
    isBlock,
    isErr,
    isSkip,
    cardClass,
    pillClass,
    actualBlockClass,
    hasExpected,
    hasActual,
    expected: hasExpected ? step.expected.trim() : null,
    actual: hasActual ? step.actual.trim() : null,
  };
}
