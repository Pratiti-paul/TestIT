import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import {
  getLlmConfig,
  detectProhibitedActions,
  analyzeCredentialRequirements,
  generateDeterministicPlan,
  planAiTest,
} from '../src/services/aiPlannerService.js';
import { runAiTest } from '../src/services/aiTestRunner.js';

describe('AI-Driven Website Testing Engine', () => {
  let mockServer;
  let mockServerUrl;

  before(async () => {
    // Spin up an authorized local mock server to test real browser interactions
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Mock Pharmacy</title></head>
            <body>
              <h1>Welcome to Mock Pharmacy</h1>
              <input type="search" placeholder="Search..." id="search-box" />
              <button id="search-btn">Search</button>
              <div id="results" style="display:none;">
                <p>Results for Paracetamol</p>
                <div class="product">
                  <span class="product-name">Paracetamol 500mg</span>
                  <button class="add-to-cart">Add to Cart</button>
                </div>
              </div>
              <div id="cart" style="display:none;">
                <p>Shopping Cart</p>
                <p>Paracetamol 500mg</p>
                <p>Qty: 1</p>
                <p>Total: $12.50</p>
              </div>
              <script>
                document.getElementById('search-btn').addEventListener('click', () => {
                  document.getElementById('results').style.display = 'block';
                });
                document.querySelector('.add-to-cart').addEventListener('click', () => {
                  document.getElementById('cart').style.display = 'block';
                });
              </script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    mockServerUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  describe('1. Safety & Prohibited Action Detection', () => {
    it('detects live payment and financial transaction attempts', () => {
      const violations = detectProhibitedActions(
        'Submit credit card with CVV 123 and make real purchase via Stripe'
      );
      assert.ok(violations.length > 0);
      assert.match(violations[0], /monetary payments/i);
    });

    it('detects destructive deletion commands', () => {
      const violations = detectProhibitedActions('Delete all users and drop table accounts');
      assert.ok(violations.length > 0);
      assert.match(violations[0], /destructive deletion/i);
    });

    it('detects attempts to bypass CAPTCHA or security controls', () => {
      const violations = detectProhibitedActions('Bypass captcha and sql injection on login form');
      assert.ok(violations.length > 0);
      assert.match(violations[0], /bypass captcha/i);
    });

    it('allows benign user flow testing instructions', () => {
      const violations = detectProhibitedActions(
        'Search for Paracetamol, add first result to cart, and verify total price'
      );
      assert.equal(violations.length, 0);
    });
  });

  describe('2. Credential Requirements & Prerequisite Analyzer', () => {
    it('flags missing credentials when valid login is requested without test account', () => {
      const check = analyzeCredentialRequirements(
        'Log in with valid credentials and inspect user dashboard'
      );
      assert.equal(check.requiresAuth, true);
      assert.equal(check.hasValidCredentials, false);
      assert.deepEqual(check.missingCredentials, ['Username / Email', 'Password']);
    });

    it('recognizes valid credentials when properly supplied in payload', () => {
      const check = analyzeCredentialRequirements(
        'Log in with valid credentials and inspect user dashboard',
        { username: 'testuser@example.com', password: 'SecretPassword123' }
      );
      assert.equal(check.requiresAuth, true);
      assert.equal(check.hasValidCredentials, true);
      assert.deepEqual(check.missingCredentials, []);
    });

    it('does not require credentials for search or cart browsing', () => {
      const check = analyzeCredentialRequirements(
        'Search for Paracetamol and add first result to cart'
      );
      assert.equal(check.requiresAuth, false);
      assert.deepEqual(check.missingCredentials, []);
    });
  });

  describe('3. AI Planner & Deterministic Fallback Engine', () => {
    it('clearly labels fallback planner when no LLM API key is configured', async () => {
      // Temporarily ensure no LLM keys
      const origGemini = process.env.GEMINI_API_KEY;
      const origOpenAi = process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const plan = await planAiTest({
          url: 'https://example.com',
          instructions: 'Search for Aspirin and verify results appear',
        });

        assert.ok(plan);
        assert.equal(plan.planner.aiConfigured, false);
        assert.equal(plan.planner.mode, 'deterministic_fallback');
        assert.match(plan.planner.notice, /deterministic fallback rules engine/i);
        assert.ok(Array.isArray(plan.steps));
        assert.ok(plan.steps.length > 0);
      } finally {
        if (origGemini) process.env.GEMINI_API_KEY = origGemini;
        if (origOpenAi) process.env.OPENAI_API_KEY = origOpenAi;
      }
    });

    it('blocks execution when prohibited safety actions are requested', async () => {
      const plan = await planAiTest({
        url: 'https://example.com',
        instructions: 'Test payment gateway and submit real credit card transaction with CVV',
      });

      assert.equal(plan.status, 'blocked');
      assert.match(plan.blockedReason, /Safety restriction/i);
      assert.ok(plan.prohibitedActions.length > 0);
      assert.equal(plan.steps.length, 0);
    });

    it('blocks execution when only authenticated login is requested without credentials', async () => {
      const plan = await planAiTest({
        url: 'https://example.com',
        instructions: 'Log in with valid credentials and verify user profile',
      });

      assert.equal(plan.status, 'blocked');
      assert.match(plan.blockedReason, /Authentication credentials required/i);
      assert.deepEqual(plan.missingCredentials, ['Username / Email', 'Password']);
    });

    it('generates multi-step flow for login, search, cart, and price verification', () => {
      const plan = generateDeterministicPlan({
        url: 'https://medico.example.com',
        instructions:
          'Test login with invalid credentials. Then search for Paracetamol, add first result to cart, and verify total price.',
      });

      assert.ok(plan.steps.length >= 5);
      const actions = plan.steps.map((s) => s.action);
      assert.ok(actions.includes('navigate'));
      assert.ok(actions.includes('fill'));
      assert.ok(actions.includes('click'));
      assert.ok(actions.includes('assertVisible'));
      assert.ok(actions.includes('screenshot'));
    });

    it('marks unsupported custom objectives as unsupported without creating generic visibility steps', async () => {
      const customObjectives = [
        'Create a ticket, edit its title, and verify that the change persists.',
        'Change a profile setting and verify it remains changed after reloading.',
      ];

      for (const instructions of customObjectives) {
        // Direct deterministic plan check
        const rawPlan = generateDeterministicPlan({
          url: 'https://example.com',
          instructions,
        });

        assert.equal(rawPlan.status, 'unsupported');
        assert.equal(rawPlan.steps.length, 0);
        assert.equal(rawPlan.userInstructions, instructions);
        assert.match(rawPlan.unsupportedReason, /cannot reliably interpret or plan this custom objective/i);

        // Verify full planAiTest wrapper returns structured unsupported outcome
        const plan = await planAiTest({
          url: 'https://example.com',
          instructions,
        });

        assert.equal(plan.status, 'unsupported');
        assert.equal(plan.steps.length, 0);
        assert.equal(plan.userInstructions, instructions);
        assert.match(plan.blockedReason, /without an AI model/i);
        assert.equal(plan.planner.aiConfigured, false);
        assert.equal(plan.planner.mode, 'deterministic_fallback');
      }
    });

    it('preserves date synchronization as a supported deterministic flow', () => {
      const plan = generateDeterministicPlan({
        url: 'https://example.com',
        instructions: 'Check date and day synchronization on the home screen',
      });

      assert.equal(plan.status, 'ready');
      assert.ok(plan.steps.length > 0);
      const actions = plan.steps.map((s) => s.action);
      assert.ok(actions.includes('assertDateSync'));
    });
  });

  describe('4. Real Browser Execution via Playwright', () => {
    it('executes planned search and cart verification successfully', async () => {
      const plan = generateDeterministicPlan({
        url: mockServerUrl,
        instructions: 'Search for Paracetamol, add first result to cart, and verify total price',
      });

      const report = await runAiTest(plan, mockServerUrl, { allowLocalForTesting: true });

      assert.ok(report);
      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.ok(report.executedSteps >= 4);
      assert.ok(report.pageDiagnostics);
      assert.equal(report.pageDiagnostics.title, 'Mock Pharmacy');
      assert.equal(report.pageDiagnostics.httpStatus, 200);

      // Check evidence screenshot was captured
      const screenshotStep = report.steps.find((s) => s.action === 'screenshot');
      assert.ok(screenshotStep);
      assert.match(screenshotStep.screenshot, /^data:image\/png;base64,/);
    });

    it('reports failure accurately with screenshot evidence when assertion fails', async () => {
      const badPlan = {
        objective: 'Test non-existent element',
        steps: [
          {
            id: 'step-1',
            action: 'navigate',
            url: mockServerUrl,
            description: 'Navigate to mock pharmacy',
            timeoutMs: 3000,
          },
          {
            id: 'step-2',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'NonExistentMedicine999' },
            description: 'Verify non-existent medicine is visible',
            timeoutMs: 1500,
          },
        ],
      };

      const report = await runAiTest(badPlan, mockServerUrl, { allowLocalForTesting: true });

      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 1);
      assert.ok(report.failure);
      assert.equal(report.failure.stepIndex, 2);
      assert.match(report.failure.message, /Unable to locate accessible control/i);

      // Check failure screenshot was captured
      const failedStep = report.steps[1];
      assert.equal(failedStep.status, 'FAIL');
      assert.match(failedStep.screenshot, /^data:image\/png;base64,/);
    });

    it('handles blocked plans immediately without launching browser', async () => {
      const blockedPlan = {
        status: 'blocked',
        blockedReason: 'Authentication credentials required',
        objective: 'Blocked: Credentials missing',
        planner: { mode: 'credential_guard' },
        missingCredentials: ['Password'],
        steps: [],
      };

      const report = await runAiTest(blockedPlan, 'https://example.com');
      assert.equal(report.status, 'blocked');
      assert.equal(report.blockedReason, 'Authentication credentials required');
      assert.equal(report.executedSteps, 0);
      assert.deepEqual(report.steps, []);
    });

    it('handles unsupported plans immediately without launching browser and preserves instructions', async () => {
      const unsupportedPlan = {
        status: 'unsupported',
        unsupportedReason: 'The deterministic fallback engine cannot reliably plan this custom journey without an AI model.',
        objective: 'Unsupported objective: Create a ticket and edit title',
        instructions: 'Create a ticket and edit title',
        planner: { mode: 'deterministic_fallback', aiConfigured: false },
        steps: [],
      };

      const report = await runAiTest(unsupportedPlan, 'https://example.com');
      assert.equal(report.status, 'unsupported');
      assert.match(report.blockedReason, /cannot reliably plan this custom journey/i);
      assert.equal(report.totalSteps, 0);
      assert.equal(report.executedSteps, 0);
      assert.equal(report.passedSteps, 0);
      assert.equal(report.failedSteps, 0);
      assert.equal(report.userInstructions, 'Create a ticket and edit title');
      assert.deepEqual(report.steps, []);
    });
  });

  describe('5. Primary API Endpoint: POST /api/ai-tests/run', () => {
    let apiServer;
    let apiBaseUrl;

    before(async () => {
      apiServer = http.createServer(app);
      await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
      const port = apiServer.address().port;
      apiBaseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
      if (apiServer) {
        await new Promise((resolve) => apiServer.close(resolve));
      }
    });

    it('rejects missing or empty URL with HTTP 400', async () => {
      const res = await fetch(`${apiBaseUrl}/api/ai-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: 'Search for medicine' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.message, /URL is required/i);
    });

    it('rejects missing instructions with HTTP 400', async () => {
      const res = await fetch(`${apiBaseUrl}/api/ai-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.message, /instructions are required/i);
    });

    it('rejects loopback and private IP targets with HTTP 400 for SSRF safety', async () => {
      const res = await fetch(`${apiBaseUrl}/api/ai-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://169.254.169.254',
          instructions: 'Search for metadata',
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.message, /rejected destination URL/i);
    });

    it('returns structured blocked report when credentials are required but missing', async () => {
      const res = await fetch(`${apiBaseUrl}/api/ai-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com',
          instructions: 'Log in with valid credentials and inspect user account',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.data.status, 'blocked');
      assert.match(data.data.blockedReason, /Authentication credentials required/i);
      assert.deepEqual(data.data.missingCredentials, ['Username / Email', 'Password']);
    });

    it('returns structured unsupported report with HTTP 200 for custom unhandled user flow', async () => {
      const customInstruction = 'Create a ticket, edit its title, and verify that the change persists.';
      const res = await fetch(`${apiBaseUrl}/api/ai-tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com',
          instructions: customInstruction,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.data.status, 'unsupported');
      assert.match(data.data.blockedReason, /cannot reliably interpret or plan this custom objective/i);
      assert.equal(data.data.totalSteps, 0);
      assert.equal(data.data.passedSteps, 0);
      assert.equal(data.data.failedSteps, 0);
      assert.equal(data.data.userInstructions, customInstruction);
      assert.deepEqual(data.data.steps, []);
    });
  });
});
