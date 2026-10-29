import { validateUrl } from './urlValidator.js';

export const ALLOWED_ACTIONS = [
  'navigate',
  'click',
  'fill',
  'select',
  'assertVisible',
  'assertText',
  'assertUrl',
  'assertCount',
  'assertInvalidLogin',
  'assertAuthenticatedState',
  'ensureLoginPage',
  'ensureSearchPage',
  'resetAuthSession',
  'assertDateSync',
  'screenshot',
];

export const ALLOWED_STRATEGIES = ['role', 'label', 'placeholder', 'text', 'css'];

export const SAMPLE_FUNCTIONAL_TEST = {
  name: 'Generic Search & Results Flow',
  description: 'Navigates to starting page, inputs a query into the search field, clicks search, and verifies results are visible.',
  startUrl: 'https://example.com',
  steps: [
    {
      id: 'step-1',
      action: 'navigate',
      url: 'https://example.com',
      description: 'Navigate to target website',
      timeoutMs: 8000,
    },
    {
      id: 'step-2',
      action: 'fill',
      target: {
        strategy: 'placeholder',
        value: 'Search...',
      },
      value: 'Item',
      description: 'Fill search field with query',
      timeoutMs: 5000,
    },
    {
      id: 'step-3',
      action: 'click',
      target: {
        strategy: 'role',
        value: 'button',
        name: 'Search',
      },
      description: 'Click search button',
      timeoutMs: 5000,
    },
    {
      id: 'step-4',
      action: 'assertVisible',
      target: {
        strategy: 'text',
        value: 'Results',
      },
      description: 'Verify search results are displayed',
      timeoutMs: 5000,
    },
  ],
  options: {
    timeoutMs: 30000,
    stepTimeoutMs: 5000,
  },
};

/**
 * Validates target locator configuration.
 *
 * @param {object} target
 * @param {number} stepIndex
 * @returns {string[]} errors
 */
function validateTarget(target, stepIndex) {
  const errors = [];
  if (!target || typeof target !== 'object') {
    errors.push(`Step ${stepIndex}: A valid "target" object is required.`);
    return errors;
  }

  const { strategy, value } = target;

  if (!strategy || !ALLOWED_STRATEGIES.includes(strategy)) {
    errors.push(
      `Step ${stepIndex}: Target strategy "${strategy}" is invalid. Allowed: ${ALLOWED_STRATEGIES.join(
        ', '
      )}.`
    );
  }

  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`Step ${stepIndex}: Target "value" must be a non-empty string.`);
  }

  return errors;
}

/**
 * Validates a functional test definition.
 *
 * @param {object} definition
 * @param {object} [options]
 * @param {boolean} [options.allowLocalForTesting]
 * @returns {Promise<{ valid: boolean, errors: string[], normalizedDefinition?: object }>}
 */
export async function validateTestDefinition(definition, options = {}) {
  const errors = [];

  if (!definition || typeof definition !== 'object') {
    return { valid: false, errors: ['Test definition must be a valid JSON object.'] };
  }

  const { name, startUrl, steps, description, options: testOptions } = definition;

  // 1. Name check
  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Test "name" is required.');
  } else if (name.trim().length > 120) {
    errors.push('Test "name" cannot exceed 120 characters.');
  }

  // 2. Start URL check
  let startOrigin = null;
  if (!startUrl || typeof startUrl !== 'string' || !startUrl.trim()) {
    errors.push('Test "startUrl" is required and must be a valid URL.');
  } else {
    const urlValidation = await validateUrl(startUrl.trim(), {
      allowLoopback: options.allowLocalForTesting === true,
    });
    if (!urlValidation.isValid) {
      errors.push(`Invalid startUrl: ${urlValidation.error}`);
    } else {
      try {
        startOrigin = new URL(urlValidation.url).origin;
      } catch {
        errors.push('startUrl origin could not be resolved.');
      }
    }
  }

  // 3. Steps check
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('Test must contain a non-empty "steps" array.');
  } else if (steps.length > 25) {
    errors.push('Test cannot exceed the limit of 25 steps per execution.');
  } else {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepIndex = i + 1;

      if (!step || typeof step !== 'object') {
        errors.push(`Step ${stepIndex}: Must be a valid object.`);
        continue;
      }

      const { action, timeoutMs } = step;

      if (!action || !ALLOWED_ACTIONS.includes(action)) {
        errors.push(
          `Step ${stepIndex}: Action "${action}" is unsupported. Supported actions: ${ALLOWED_ACTIONS.join(
            ', '
          )}.`
        );
        continue;
      }

      if (timeoutMs !== undefined) {
        if (typeof timeoutMs !== 'number' || timeoutMs < 500 || timeoutMs > 15000) {
          errors.push(
            `Step ${stepIndex}: "timeoutMs" must be a number between 500 and 15000 milliseconds.`
          );
        }
      }

      // Action-specific validations
      switch (action) {
        case 'navigate': {
          if (!step.url || typeof step.url !== 'string' || !step.url.trim()) {
            errors.push(`Step ${stepIndex}: "navigate" action requires a valid "url" string.`);
          } else {
            let stepOrigin = null;
            try {
              stepOrigin = new URL(step.url.trim()).origin;
              if (startOrigin && stepOrigin !== startOrigin) {
                errors.push(
                  `Step ${stepIndex}: Navigation to cross-origin "${stepOrigin}" is not permitted (must match starting origin "${startOrigin}").`
                );
              }
            } catch {
              errors.push(`Step ${stepIndex}: Malformed navigate URL.`);
            }

            const stepUrlValidation = await validateUrl(step.url.trim(), {
              allowLoopback: options.allowLocalForTesting === true,
            });
            if (!stepUrlValidation.isValid) {
              errors.push(`Step ${stepIndex}: Navigate URL is restricted: ${stepUrlValidation.error}`);
            }
          }
          break;
        }

        case 'click':
        case 'assertVisible': {
          errors.push(...validateTarget(step.target, stepIndex));
          break;
        }

        case 'fill': {
          errors.push(...validateTarget(step.target, stepIndex));
          if (step.value === undefined || step.value === null || typeof step.value !== 'string') {
            errors.push(`Step ${stepIndex}: "fill" action requires a "value" string.`);
          }
          break;
        }

        case 'select': {
          errors.push(...validateTarget(step.target, stepIndex));
          if (typeof step.value !== 'string' || !step.value.trim()) {
            errors.push(`Step ${stepIndex}: "select" action requires a non-empty "value" string.`);
          }
          break;
        }

        case 'assertText': {
          errors.push(...validateTarget(step.target, stepIndex));
          if (typeof step.value !== 'string' || !step.value.trim()) {
            errors.push(
              `Step ${stepIndex}: "assertText" action requires a non-empty "value" string to verify.`
            );
          }
          break;
        }

        case 'assertUrl': {
          if (typeof step.value !== 'string' || !step.value.trim()) {
            errors.push(
              `Step ${stepIndex}: "assertUrl" action requires an expected "value" string (path or substring).`
            );
          }
          break;
        }

        case 'assertCount': {
          errors.push(...validateTarget(step.target, stepIndex));
          if (typeof step.value !== 'number' || step.value < 0 || !Number.isInteger(step.value)) {
            errors.push(
              `Step ${stepIndex}: "assertCount" action requires a non-negative integer "value".`
            );
          }
          break;
        }

        case 'assertInvalidLogin':
        case 'assertAuthenticatedState':
        case 'ensureLoginPage':
        case 'ensureSearchPage':
        case 'assertDateSync':
        case 'screenshot':
          // Optional target or metadata
          break;
      }
    }
  }

  // 4. Options check
  let normalizedTimeout = 30000;
  let normalizedStepTimeout = 5000;

  if (testOptions && typeof testOptions === 'object') {
    if (testOptions.timeoutMs !== undefined) {
      if (
        typeof testOptions.timeoutMs !== 'number' ||
        testOptions.timeoutMs < 5000 ||
        testOptions.timeoutMs > 60000
      ) {
        errors.push('options.timeoutMs must be between 5000 and 60000 ms.');
      } else {
        normalizedTimeout = testOptions.timeoutMs;
      }
    }

    if (testOptions.stepTimeoutMs !== undefined) {
      if (
        typeof testOptions.stepTimeoutMs !== 'number' ||
        testOptions.stepTimeoutMs < 1000 ||
        testOptions.stepTimeoutMs > 15000
      ) {
        errors.push('options.stepTimeoutMs must be between 1000 and 15000 ms.');
      } else {
        normalizedStepTimeout = testOptions.stepTimeoutMs;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    normalizedDefinition: {
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      startUrl: startUrl.trim(),
      steps: steps.map((s, idx) => ({
        id: s.id || `step-${idx + 1}`,
        description: s.description || `${s.action} action`,
        ...s,
      })),
      options: {
        timeoutMs: normalizedTimeout,
        stepTimeoutMs: normalizedStepTimeout,
      },
    },
  };
}
