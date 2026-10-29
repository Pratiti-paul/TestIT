import { validateUrl } from '../utils/urlValidator.js';
import { planAiTest } from '../services/aiPlannerService.js';
import { runAiTest } from '../services/aiTestRunner.js';

/**
 * POST /api/ai-tests/run
 *
 * Single primary endpoint for AI-driven website testing:
 * 1. Validates target URL and safety.
 * 2. Uses AI planner (or deterministic fallback) to generate test plan.
 * 3. Executes browser interactions with Playwright.
 * 4. Returns structured results with step outcomes, assertions, and evidence.
 */
export const runAiTestEndpoint = async (req, res) => {
  try {
    const { url, instructions, credentials, authorized } = req.body || {};

    // 1. Basic input validation
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A target website URL is required.',
        code: 'MISSING_URL',
      });
    }

    if (!instructions || typeof instructions !== 'string' || !instructions.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Testing instructions are required. Please describe what the AI should test.',
        code: 'MISSING_INSTRUCTIONS',
      });
    }

    const trimmedUrl = url.trim();

    // 2. Validate URL protocol
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL: Only HTTP and HTTPS protocols are supported.',
        code: 'INVALID_PROTOCOL',
      });
    }

    // 3. Authoritative destination and SSRF validation
    const urlCheck = await validateUrl(trimmedUrl);
    if (!urlCheck.isValid) {
      return res.status(400).json({
        success: false,
        message: `Security validation rejected destination URL: ${urlCheck.error}`,
        code: 'BLOCKED_DESTINATION',
      });
    }

    // 4. Generate AI test plan
    const plan = await planAiTest({
      url: trimmedUrl,
      instructions: instructions.trim(),
      credentials: credentials || {},
    });

    // 5. Execute browser test with Playwright
    const report = await runAiTest(plan, trimmedUrl);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        code: err.code || 'AI_TEST_ERROR',
      });
    }

    console.error('Unhandled AI test runner error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'An unexpected error occurred during AI test execution.',
      code: 'INTERNAL_RUNNER_ERROR',
    });
  }
};

