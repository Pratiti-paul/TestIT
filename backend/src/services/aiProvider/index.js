import { GeminiProvider } from './geminiProvider.js';
import { OpenAiProvider } from './openaiProvider.js';
import { MockProvider } from './mockProvider.js';
import { executeWithRetry } from './retryHelper.js';

export {
  ProviderError,
  redactSecrets,
  classifyProviderError,
  createProviderHttpError,
  wrapProviderError,
  sanitizeErrorString,
} from './providerSanitizer.js';

export { executeWithRetry };
export { GeminiProvider, OpenAiProvider, MockProvider };

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
 * Safely repairs an unsupported target strategy into a canonical strategy.
 * Preserves the original target meaning and action intent.
 * Never silently substitutes an arbitrary locator strategy.
 *
 * @param {object} target
 * @param {object} [observation]
 * @returns {{ repaired: boolean, target?: object, error?: string, repairDetails?: object }}
 */
export function repairTargetStrategy(target, observation = null) {
  if (!target || typeof target !== 'object') {
    return { repaired: false, error: 'Target must be a non-null object.' };
  }

  const { strategy, value, name } = target;
  if (!strategy || typeof strategy !== 'string') {
    return { repaired: false, error: 'Target missing strategy.' };
  }

  const rawStrategy = strategy.trim().toLowerCase();

  // If already canonical, return unchanged
  if (LOCATOR_STRATEGIES.includes(rawStrategy)) {
    return { repaired: false, target };
  }

  const targetVal = typeof value === 'string' ? value.trim() : '';
  if (!targetVal) {
    return {
      repaired: false,
      error: `Cannot repair unsupported strategy "${strategy}" with empty target value.`,
    };
  }

  // 1. Strategy "name": W3C HTML attribute name -> CSS [name="..."]
  if (rawStrategy === 'name') {
    const escapedVal = targetVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const repairedCss = `[name="${escapedVal}"]`;
    return {
      repaired: true,
      target: {
        ...target,
        strategy: 'css',
        value: repairedCss,
      },
      repairDetails: {
        originalStrategy: 'name',
        repairedStrategy: 'css',
        originalValue: targetVal,
        repairedValue: repairedCss,
        reason: 'Converted unsupported "name" strategy to canonical CSS attribute selector [name="..."] preserving exact target attribute.',
      },
    };
  }

  // 2. Strategy "id": HTML id -> CSS [id="..."]
  if (rawStrategy === 'id') {
    const escapedVal = targetVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const repairedCss = `[id="${escapedVal}"]`;
    return {
      repaired: true,
      target: {
        ...target,
        strategy: 'css',
        value: repairedCss,
      },
      repairDetails: {
        originalStrategy: 'id',
        repairedStrategy: 'css',
        originalValue: targetVal,
        repairedValue: repairedCss,
        reason: 'Converted unsupported "id" strategy to canonical CSS attribute selector [id="..."] preserving exact target attribute.',
      },
    };
  }

  // 3. Strategy "class" or "classname": CSS class selector
  if (rawStrategy === 'class' || rawStrategy === 'classname') {
    const repairedCss = targetVal.startsWith('.') ? targetVal : `.${targetVal.replace(/\s+/g, '.')}`;
    return {
      repaired: true,
      target: {
        ...target,
        strategy: 'css',
        value: repairedCss,
      },
      repairDetails: {
        originalStrategy: strategy,
        repairedStrategy: 'css',
        originalValue: targetVal,
        repairedValue: repairedCss,
        reason: 'Converted unsupported class strategy to canonical CSS class selector.',
      },
    };
  }

  // 4. Strategy "tag" or "tagname": CSS element selector
  if (rawStrategy === 'tag' || rawStrategy === 'tagname') {
    return {
      repaired: true,
      target: {
        ...target,
        strategy: 'css',
        value: targetVal.toLowerCase(),
      },
      repairDetails: {
        originalStrategy: strategy,
        repairedStrategy: 'css',
        originalValue: targetVal,
        repairedValue: targetVal.toLowerCase(),
        reason: 'Converted unsupported tag strategy to canonical CSS tag selector.',
      },
    };
  }

  // Unknown or arbitrary strategy -> do not guess!
  return {
    repaired: false,
    error: `Target strategy "${strategy}" is invalid and cannot be safely repaired. Allowed strategies: ${LOCATOR_STRATEGIES.join(', ')}.`,
  };
}

/**
 * Validates action decision from AI provider against strict schema.
 * Supports bounded, safe target strategy repair when allowed.
 *
 * @param {object} decision
 * @param {object} [options]
 * @param {boolean} [options.allowRepair=true]
 * @param {object} [options.observation]
 * @returns {{ valid: boolean, repaired?: boolean, repairDetails?: object, error?: string }}
 */
export function validateAgentDecision(decision, options = {}) {
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
      const repairRes = options.allowRepair !== false ? repairTargetStrategy(target, options.observation) : null;
      if (repairRes?.repaired && repairRes.target) {
        decision.target = repairRes.target;
        return {
          valid: true,
          repaired: true,
          repairDetails: repairRes.repairDetails,
        };
      }
      return {
        valid: false,
        error:
          repairRes?.error ||
          `Target strategy "${target.strategy}" is invalid. Allowed: ${LOCATOR_STRATEGIES.join(', ')}.`,
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
 * Returns primary and fallback AI provider instances.
 * If both Gemini and OpenAI are configured, the second acts as seamless failover.
 *
 * @param {object} [options]
 * @returns {{ primaryProvider: GeminiProvider | OpenAiProvider | MockProvider | null, fallbackProvider: GeminiProvider | OpenAiProvider | MockProvider | null }}
 */
export function getAiProviderBundle(options = {}) {
  if (options.provider) {
    return {
      primaryProvider: options.provider,
      fallbackProvider: options.fallbackProvider || null,
    };
  }

  if (
    options.allowMock &&
    (options.mockSteps || options.mockObjectives || process.env.TESTIT_USE_MOCK_AGENT === 'true')
  ) {
    const mock = new MockProvider(options.mockSteps || [], options.mockObjectives || null);
    return {
      primaryProvider: mock,
      fallbackProvider: options.fallbackProvider || null,
    };
  }

  let primary = null;
  let fallback = null;

  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

  if (hasGemini) {
    primary = new GeminiProvider(
      process.env.GEMINI_API_KEY.trim(),
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      options
    );
    if (hasOpenAi) {
      fallback = new OpenAiProvider(
        process.env.OPENAI_API_KEY.trim(),
        process.env.OPENAI_MODEL || 'gpt-4o-mini',
        options
      );
    }
  } else if (hasOpenAi) {
    primary = new OpenAiProvider(
      process.env.OPENAI_API_KEY.trim(),
      process.env.OPENAI_MODEL || 'gpt-4o-mini',
      options
    );
  }

  if (options.fallbackProvider) {
    fallback = options.fallbackProvider;
  }

  return { primaryProvider: primary, fallbackProvider: fallback };
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
  const bundle = getAiProviderBundle(options);
  return bundle.primaryProvider;
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
