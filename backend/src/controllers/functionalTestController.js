import {
  ALLOWED_ACTIONS,
  ALLOWED_STRATEGIES,
  SAMPLE_FUNCTIONAL_TEST,
  validateTestDefinition,
} from '../utils/functionalTestValidator.js';
import { runFunctionalTest } from '../services/functionalTestRunner.js';

/**
 * GET /api/functional-tests/schema
 * Returns supported step types, strategies, and a sample test definition.
 */
export const getTestSchema = (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      supportedActions: ALLOWED_ACTIONS,
      supportedStrategies: ALLOWED_STRATEGIES,
      sampleTest: SAMPLE_FUNCTIONAL_TEST,
    },
  });
};

/**
 * POST /api/functional-tests/validate
 * Validates a test definition without running it.
 */
export const validateDefinition = async (req, res) => {
  try {
    const definition = req.body;
    const result = await validateTestDefinition(definition);

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        errors: result.errors,
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      normalizedDefinition: result.normalizedDefinition,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      valid: false,
      errors: [err.message || 'Validation failed'],
    });
  }
};

/**
 * POST /api/functional-tests/execute
 * Executes a validated functional test against the target website.
 */
export const executeTest = async (req, res) => {
  try {
    const definition = req.body;
    const report = await runFunctionalTest(definition);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        code: err.code || 'TEST_EXECUTION_FAILED',
        errors: err.errors || undefined,
      });
    }

    console.error('Unhandled functional test runner error:', err);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during test execution.',
      code: 'INTERNAL_TEST_ERROR',
    });
  }
};

