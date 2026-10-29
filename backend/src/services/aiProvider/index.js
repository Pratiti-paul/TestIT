import { GeminiProvider } from './geminiProvider.js';
import { OpenAiProvider } from './openaiProvider.js';
import { MockProvider } from './mockProvider.js';

/**
 * Supported actions for the autonomous agent.
 */
export const AGENT_ACTIONS = [
  'click',
  'fill',
  'select',
  'pressKey',
  'navigate',
  'refresh',
  'waitForTimeout',
  'assertVisible',
  'assertText',
  'assertDateSync',
  'screenshot',
  'conclude',
];

/**
 * Supported locator strategies.
 */
export const LOCATOR_STRATEGIES = ['role', 'label', 'placeholder', 'text', 'css'];

/**
 * Validates action decision from AI provider against strict schema.
 *
 * @param {object} decision
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAgentDecision(decision) {
  if (!decision || typeof decision !== 'object') {
    return { valid: false, error: 'Model decision must be a non-null object.' };
  }

  const { action, target, conclude } = decision;

  if (!action || !AGENT_ACTIONS.includes(action)) {
    return {
      valid: false,
      error: `Action "${action}" is invalid. Allowed actions: ${AGENT_ACTIONS.join(', ')}.`,
    };
  }

  if (action === 'conclude') {
    if (!conclude || typeof conclude !== 'object') {
      return { valid: false, error: '"conclude" action requires a "conclude" object.' };
    }
    const allowedOutcomes = ['PASS', 'FAIL', 'BLOCKED', 'NEEDS_CLARIFICATION'];
    if (!allowedOutcomes.includes(conclude.outcome)) {
      return {
        valid: false,
        error: `Conclude outcome "${conclude.outcome}" is invalid. Must be one of: ${allowedOutcomes.join(', ')}.`,
      };
    }
    if (!conclude.reasoning || typeof conclude.reasoning !== 'string') {
      return { valid: false, error: 'Conclude requires a non-empty "reasoning" string.' };
    }
    return { valid: true };
  }

  // Target validation for actions requiring target
  const requiresTarget = ['click', 'fill', 'select', 'assertVisible', 'assertText'];
  if (requiresTarget.includes(action)) {
    if (!target || typeof target !== 'object') {
      return { valid: false, error: `Action "${action}" requires a valid "target" object.` };
    }
    if (!target.strategy || !LOCATOR_STRATEGIES.includes(target.strategy)) {
      return {
        valid: false,
        error: `Target strategy "${target.strategy}" is invalid. Allowed: ${LOCATOR_STRATEGIES.join(', ')}.`,
      };
    }
    if (!target.value || typeof target.value !== 'string' || !target.value.trim()) {
      return { valid: false, error: `Target for "${action}" requires a non-empty string "value".` };
    }
  }

  // Value validation
  if (action === 'fill' || action === 'select' || action === 'assertText' || action === 'pressKey') {
    if (decision.value === undefined || decision.value === null) {
      return { valid: false, error: `Action "${action}" requires a "value" parameter.` };
    }
  }

  return { valid: true };
}

/**
 * Returns the configured AI provider instance or null.
 * Strictly reads from environment variables.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowMock=false]
 * @param {Array} [options.mockSteps]
 * @returns {GeminiProvider | OpenAiProvider | MockProvider | null}
 */
export function getActiveAiProvider(options = {}) {
  if (
    options.allowMock &&
    (options.mockSteps || options.mockObjectives || process.env.TESTIT_USE_MOCK_AGENT === 'true')
  ) {
    return new MockProvider(options.mockSteps || [], options.mockObjectives || null);
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return new GeminiProvider(
      process.env.GEMINI_API_KEY.trim(),
      process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    );
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    return new OpenAiProvider(
      process.env.OPENAI_API_KEY.trim(),
      process.env.OPENAI_MODEL || 'gpt-4o-mini'
    );
  }

  return null;
}

/**
 * Formats an explicit error report when no AI provider is configured.
 *
 * @param {string} url
 * @param {string} instructions
 * @returns {object}
 */
export function getMissingProviderReport(url, instructions) {
  return {
    testName: `AI QA Test: ${instructions.slice(0, 100)}`,
    startUrl: url,
    finalUrl: url,
    status: 'blocked',
    blockedReason:
      'No AI provider API key configured. To enable autonomous website testing, please set GEMINI_API_KEY (recommended: gemini-2.5-flash) or OPENAI_API_KEY in backend/.env and restart the server.',
    objective: instructions,
    planner: {
      mode: 'unconfigured',
      provider: null,
      model: null,
      aiConfigured: false,
      notice:
        'AI Provider Not Configured: Add GEMINI_API_KEY=... in backend/.env to activate the autonomous QA agent.',
    },
    missingCredentials: [],
    prohibitedActions: [],
    durationMs: 0,
    totalSteps: 0,
    executedSteps: 0,
    passedSteps: 0,
    failedSteps: 0,
    blockedSteps: 1,
    errorSteps: 0,
    skippedSteps: 0,
    steps: [],
    failure: null,
    coverageAndLimitations: {
      tested: 'None (blocked by environment configuration)',
      notTested: instructions,
      missingPrerequisites: ['GEMINI_API_KEY or OPENAI_API_KEY in backend/.env'],
      ambiguousExpectations: null,
      executionLimitations: 'Autonomous agent requires a configured LLM provider to reason about arbitrary websites.',
    },
  };
}

