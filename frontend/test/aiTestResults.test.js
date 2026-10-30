import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStatusBanner,
  resolvePlannerAttribution,
  resolveFailureDetails,
  resolveStepDetails,
} from '../src/utils/aiTestResultsPresenter.js';

describe('AiTestResults Presenter & Reporting Compatibility Suite', () => {
  describe('1. Failure with description and hypothesis', () => {
    it('prefers failure.description and renders failure.hypothesis without undefined labels', () => {
      const failure = {
        description: 'Active calendar day does not match system date.',
        hypothesis: 'The page displays cached date from yesterday.',
      };

      const resolved = resolveFailureDetails(failure, false);
      assert.ok(resolved);
      assert.equal(resolved.primaryMessage, 'Active calendar day does not match system date.');
      assert.equal(resolved.hypothesis, 'The page displays cached date from yesterday.');
      assert.equal(resolved.failureHeading, 'Verification Failed');
      assert.equal(resolved.stepIndex, null);
      assert.equal(resolved.action, null);
      assert.equal(resolved.isFailureAnError, false);

      // Verify no undefined string leakage
      const values = Object.values(resolved).filter((v) => typeof v === 'string');
      for (const val of values) {
        assert.ok(!val.includes('undefined'), `Value "${val}" must not contain "undefined"`);
        assert.ok(!val.includes('null'), `Value "${val}" must not contain "null"`);
      }
    });
  });

  describe('2. Failure with expected and actual values', () => {
    it('resolves expected and actual values cleanly for UI outcome blocks', () => {
      const failure = {
        description: 'Cart total does not match expected sum.',
        expected: 'Total: $120.00',
        actual: 'Total: $150.00',
        hypothesis: 'Shipping fees were applied twice.',
      };

      const resolved = resolveFailureDetails(failure, false);
      assert.ok(resolved);
      assert.equal(resolved.hasExpected, true);
      assert.equal(resolved.hasActual, true);
      assert.equal(resolved.expected, 'Total: $120.00');
      assert.equal(resolved.actual, 'Total: $150.00');
      assert.equal(resolved.primaryMessage, 'Cart total does not match expected sum.');
      assert.equal(resolved.hypothesis, 'Shipping fees were applied twice.');
    });
  });

  describe('3. Older failure schema containing message', () => {
    it('supports failure.message as backward-compatible fallback with stepIndex and action', () => {
      const legacyFailure = {
        stepIndex: 3,
        action: 'click',
        status: 'FAIL',
        message: 'Button matching "Complete Order" was not clickable.',
      };

      const resolved = resolveFailureDetails(legacyFailure, false);
      assert.ok(resolved);
      assert.equal(resolved.failureHeading, 'Verification Failed at Step 3 (click)');
      assert.equal(resolved.primaryMessage, 'Button matching "Complete Order" was not clickable.');
      assert.equal(resolved.stepIndex, 3);
      assert.equal(resolved.action, 'click');
      assert.equal(resolved.hypothesis, null);
    });

    it('renders stepIndex cleanly without action when action is missing', () => {
      const failure = {
        stepIndex: 5,
        message: 'Timeout navigating to destination',
      };

      const resolved = resolveFailureDetails(failure, false);
      assert.ok(resolved);
      assert.equal(resolved.failureHeading, 'Verification Failed at Step 5');
      assert.ok(!resolved.failureHeading.includes('()'));
      assert.equal(resolved.primaryMessage, 'Timeout navigating to destination');
    });

    it('renders action cleanly without stepIndex when stepIndex is missing', () => {
      const failure = {
        action: 'fill',
        description: 'Unable to locate input field',
      };

      const resolved = resolveFailureDetails(failure, false);
      assert.ok(resolved);
      assert.equal(resolved.failureHeading, 'Verification Failed (fill)');
      assert.ok(!resolved.failureHeading.includes('Step'));
      assert.equal(resolved.primaryMessage, 'Unable to locate input field');
    });
  });

  describe('4. Missing optional fields', () => {
    it('handles minimal failure object without hypothesis, expected, or actual', () => {
      const failure = {
        description: 'Simple failure without optional metadata.',
      };

      const resolved = resolveFailureDetails(failure, false);
      assert.ok(resolved);
      assert.equal(resolved.failureHeading, 'Verification Failed');
      assert.equal(resolved.primaryMessage, 'Simple failure without optional metadata.');
      assert.equal(resolved.hypothesis, null);
      assert.equal(resolved.hasExpected, false);
      assert.equal(resolved.hasActual, false);
      assert.equal(resolved.expected, null);
      assert.equal(resolved.actual, null);
      assert.equal(resolved.stepIndex, null);
      assert.equal(resolved.action, null);
    });

    it('handles null, undefined, and non-object inputs safely without throwing', () => {
      assert.equal(resolveFailureDetails(null), null);
      assert.equal(resolveFailureDetails(undefined), null);
      assert.equal(resolveFailureDetails('some string'), null);
      assert.equal(resolveFailureDetails(123), null);

      const emptyBanner = resolveStatusBanner(null);
      assert.equal(emptyBanner.isPassed, false);
      assert.equal(emptyBanner.durationSec, '0.00');

      const emptyStep = resolveStepDetails(null);
      assert.equal(emptyStep.normStatus, 'UNKNOWN');
      assert.equal(emptyStep.isPass, false);
    });
  });

  describe('5. Provider errors and technical failure classification', () => {
    it('distinguishes technical errors from test assertion failures', () => {
      const errorFailure = {
        status: 'ERROR',
        description: 'AI model failed during objective planning.',
        hypothesis: 'AI provider request timed out. Verify network connectivity.',
      };

      const resolved = resolveFailureDetails(errorFailure, true);
      assert.ok(resolved);
      assert.equal(resolved.isFailureAnError, true);
      assert.equal(resolved.failureHeading, 'Technical Error');
      assert.equal(resolved.primaryMessage, 'AI model failed during objective planning.');
      assert.equal(resolved.hypothesis, 'AI provider request timed out. Verify network connectivity.');

      const banner = resolveStatusBanner({
        status: 'error',
        durationMs: 15000,
        objective: 'Verify home page',
      });
      assert.equal(banner.isError, true);
      assert.equal(banner.isFailed, false);
      assert.equal(banner.statusTitle, 'Test Execution Error');
      assert.equal(banner.durationSec, '15.00');
    });

    it('classifies provider planning failure as technical error even when step is missing', () => {
      const failure = {
        error: 'Request to Gemini timed out after 15000ms.',
        hypothesis: 'Check network connectivity or provider availability.',
      };

      const resolved = resolveFailureDetails(failure, true);
      assert.ok(resolved);
      assert.equal(resolved.failureHeading, 'Technical Error');
      assert.equal(resolved.primaryMessage, 'Request to Gemini timed out after 15000ms.');
      assert.equal(resolved.hypothesis, 'Check network connectivity or provider availability.');
    });
  });

  describe('6. Unsupported objectives and blocked reports', () => {
    it('resolves unsupported status with distinct clarification headline', () => {
      const banner = resolveStatusBanner({
        status: 'unsupported',
        objective: 'Book flight seats with customized meal plan',
      });

      assert.equal(banner.isUnsupported, true);
      assert.equal(banner.statusTitle, 'Clarification / AI Key Required');
      assert.equal(banner.statusSubtitle, 'Book flight seats with customized meal plan');
    });

    it('resolves blocked status with distinct blocked headline', () => {
      const banner = resolveStatusBanner({
        status: 'blocked',
        objective: 'Access admin user management portal',
      });

      assert.equal(banner.isBlocked, true);
      assert.equal(banner.statusTitle, 'Test Execution Blocked');
    });
  });

  describe('7. Successful and partial reports', () => {
    it('resolves successful report banner and passed steps', () => {
      const banner = resolveStatusBanner({
        status: 'passed',
        durationMs: 2450,
        objective: 'Verify logo and navigation links',
      });

      assert.equal(banner.isPassed, true);
      assert.equal(banner.statusTitle, 'Test Passed Successfully');
      assert.equal(banner.durationSec, '2.45');

      const passStep = resolveStepDetails({
        status: 'PASS',
        expected: 'Logo is visible',
        actual: 'Logo element observed in header',
      });
      assert.equal(passStep.isPass, true);
      assert.equal(passStep.cardClass, 'card-passed');
      assert.equal(passStep.pillClass, 'pill-passed');
      assert.equal(passStep.actualBlockClass, 'actual-passed');
      assert.equal(passStep.expected, 'Logo is visible');
      assert.equal(passStep.actual, 'Logo element observed in header');
    });

    it('resolves partial report banner and skipped/blocked steps', () => {
      const banner = resolveStatusBanner({
        status: 'partial',
        durationMs: 4120,
      });

      assert.equal(banner.isPartial, true);
      assert.equal(banner.statusTitle, 'Partial Test Journey Completed');

      const blockedStep = resolveStepDetails({
        status: 'BLOCKED',
        expected: 'Requires credentials',
        actual: 'No credentials provided',
      });
      assert.equal(blockedStep.isBlock, true);
      assert.equal(blockedStep.cardClass, 'card-blocked');
      assert.equal(blockedStep.pillClass, 'pill-blocked');

      const skippedStep = resolveStepDetails({
        status: 'SKIPPED',
        expected: 'Step skipped',
        actual: 'Prerequisite failed',
      });
      assert.equal(skippedStep.isSkip, true);
      assert.equal(skippedStep.cardClass, 'card-skipped');
      assert.equal(skippedStep.pillClass, 'pill-skipped');
    });
  });

  describe('8. Correct Live AI versus Fallback and Mock Attribution', () => {
    it('accurately attributes live Gemini provider as LLM Synthesized', () => {
      const planner = {
        mode: 'llm_agent',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        aiConfigured: true,
        notice: 'Powered by GEMINI (gemini-2.5-flash)',
      };

      const attr = resolvePlannerAttribution(planner);
      assert.equal(attr.isLiveAi, true);
      assert.equal(attr.plannerTitle, 'AI Planner: GEMINI (gemini-2.5-flash)');
      assert.equal(attr.plannerBadge, 'LLM Synthesized');
      assert.equal(attr.notice, 'Powered by GEMINI (gemini-2.5-flash)');
    });

    it('accurately attributes live OpenAI provider as LLM Synthesized', () => {
      const planner = {
        mode: 'llm_agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        aiConfigured: true,
      };

      const attr = resolvePlannerAttribution(planner);
      assert.equal(attr.isLiveAi, true);
      assert.equal(attr.plannerTitle, 'AI Planner: OPENAI (gpt-4o-mini)');
      assert.equal(attr.plannerBadge, 'LLM Synthesized');
    });

    it('does NOT label MockProvider as live AI or LLM Synthesized', () => {
      const planner = {
        mode: 'llm_agent',
        provider: 'mock',
        model: 'mock-test-agent',
        aiConfigured: false,
        notice: 'Autonomous QA Agent powered by MOCK.',
      };

      const attr = resolvePlannerAttribution(planner);
      assert.equal(attr.isLiveAi, false);
      assert.equal(attr.plannerTitle, 'Mock QA Agent (mock-test-agent)');
      assert.equal(attr.plannerBadge, 'Mock Engine');
      assert.notEqual(attr.plannerBadge, 'LLM Synthesized');
    });

    it('does NOT label deterministic fallback engine as live AI', () => {
      const planner = {
        mode: 'deterministic_fallback',
        provider: 'rule_based_engine',
        model: 'testit-rules-v1',
        aiConfigured: false,
        notice: 'Deterministic fallback rules engine.',
      };

      const attr = resolvePlannerAttribution(planner);
      assert.equal(attr.isLiveAi, false);
      assert.equal(attr.plannerTitle, 'Deterministic Fallback Planner');
      assert.equal(attr.plannerBadge, 'Rule-Based Engine');
      assert.notEqual(attr.plannerBadge, 'LLM Synthesized');
    });

    it('handles unconfigured provider without live AI attribution', () => {
      const planner = {
        mode: 'unconfigured',
        provider: null,
        model: null,
        aiConfigured: false,
      };

      const attr = resolvePlannerAttribution(planner);
      assert.equal(attr.isLiveAi, false);
      assert.equal(attr.plannerTitle, 'AI Provider Not Configured');
      assert.equal(attr.plannerBadge, 'Unconfigured');
      assert.notEqual(attr.plannerBadge, 'LLM Synthesized');
    });
  });
});
