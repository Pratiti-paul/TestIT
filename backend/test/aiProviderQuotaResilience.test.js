import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  executeWithRetry,
  getAiProviderBundle,
  ProviderError,
  classifyProviderError,
  redactSecrets,
  sanitizeErrorString,
} from '../src/services/aiProvider/index.js';
import { executeAiAgent } from '../src/services/aiAgentService.js';

describe('Phase 5.0B: AI Provider Quota Resilience & Execution Continuity Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/catalog') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Product Catalog</title></head>
            <body>
              <h1>Product Catalog</h1>
              <div class="product-card" id="item-jacket">
                <h3>Sauce Labs Fleece Jacket</h3>
                <span class="price">$49.99</span>
                <button id="add-to-cart-sauce-labs-fleece-jacket" onclick="addItem()">Add to cart</button>
              </div>
              <div class="shopping_cart_container">
                <a class="shopping_cart_link">
                  <span class="shopping_cart_badge" style="display:none;"></span>
                </a>
              </div>
              <div id="status-panel"></div>
              <button id="dead-btn" onclick="/* no-op */">Non-functional Button</button>
              <script>
                function addItem() {
                  const btn = document.getElementById('add-to-cart-sauce-labs-fleece-jacket');
                  btn.textContent = 'Remove';
                  btn.setAttribute('data-action', 'remove');
                  const badge = document.querySelector('.shopping_cart_badge');
                  badge.textContent = '1';
                  badge.style.display = 'inline-block';
                }
              </script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  // ==========================================================================
  // SCENARIO 1: Gemini HTTP 429 followed by successful retry
  // ==========================================================================
  it('1. retries successfully after a transient HTTP 429 rate limit', async () => {
    let callCount = 0;
    const testFn = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('HTTP 429 Rate limit exceeded. Please retry later.');
        err.status = 429;
        throw err;
      }
      return { success: true, callCount };
    };

    const result = await executeWithRetry(testFn, {
      maxRetries: 2,
      baseDelayMs: 20,
      jitterFactor: 0,
      totalTimeoutMs: 5000,
    });

    assert.strictEqual(callCount, 2, 'Should have retried once and succeeded');
    assert.strictEqual(result.success, true);
  });

  // ==========================================================================
  // SCENARIO 2: Gemini 503 followed by successful retry
  // ==========================================================================
  it('2. retries successfully after a transient HTTP 503 service unavailable', async () => {
    let callCount = 0;
    const testFn = async () => {
      callCount++;
      if (callCount <= 2) {
        const err = new Error('HTTP 503 Model service temporarily overloaded.');
        err.status = 503;
        throw err;
      }
      return { model: 'gemini-2.5-flash', output: 'step-planned' };
    };

    const result = await executeWithRetry(testFn, {
      maxRetries: 3,
      baseDelayMs: 15,
      jitterFactor: 0,
      totalTimeoutMs: 5000,
    });

    assert.strictEqual(callCount, 3, 'Should have retried twice and succeeded on 3rd try');
    assert.strictEqual(result.output, 'step-planned');
  });

  // ==========================================================================
  // SCENARIO 3: Retry-After header handling
  // ==========================================================================
  it('3. extracts and respects Retry-After headers in seconds and delta text', async () => {
    // 3A: Seconds integer in headers
    const errWithHeader = new Error('Rate limit exceeded');
    errWithHeader.headers = { 'retry-after': '1' }; // 1 second
    const classified1 = classifyProviderError(errWithHeader);
    assert.strictEqual(classified1.isRetryable, true);
    assert.strictEqual(classified1.retryAfterMs, 1000);

    // 3B: Delta text in error message e.g. "retry after 500ms"
    const errWithMsg = new Error('429 Too Many Requests: Please retry after 250ms');
    const classified2 = classifyProviderError(errWithMsg);
    assert.strictEqual(classified2.retryAfterMs, 250);

    // 3C: executeWithRetry respects parsed retryAfterMs
    let callCount = 0;
    const startTime = Date.now();
    const testFn = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('HTTP 429 Please retry after 50ms');
        err.status = 429;
        throw err;
      }
      return 'ok';
    };

    const res = await executeWithRetry(testFn, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitterFactor: 0,
      totalTimeoutMs: 5000,
    });
    const elapsed = Date.now() - startTime;
    assert.strictEqual(res, 'ok');
    assert.strictEqual(callCount, 2);
    assert.ok(elapsed >= 45, `Should have waited at least ~50ms for Retry-After (elapsed: ${elapsed}ms)`);
  });

  // ==========================================================================
  // SCENARIO 4: Exhausted quota stops retries immediately
  // ==========================================================================
  it('4. immediately halts retries on permanent quota exhaustion without delay', async () => {
    let callCount = 0;
    const testFn = async () => {
      callCount++;
      const err = new Error('You exceeded your current quota, please check your plan and billing details.');
      err.status = 429;
      throw err;
    };

    let thrownError;
    const startTime = Date.now();
    try {
      await executeWithRetry(testFn, {
        maxRetries: 5,
        baseDelayMs: 500,
        totalTimeoutMs: 10000,
      });
    } catch (err) {
      thrownError = err;
    }

    const elapsed = Date.now() - startTime;
    assert.ok(thrownError, 'Must throw error on permanent quota exhaustion');
    assert.strictEqual(callCount, 1, 'Must NOT retry when quota is permanently exhausted');
    assert.strictEqual(thrownError.isQuotaExhausted, true);
    assert.strictEqual(thrownError.isRetryable, false);
    assert.strictEqual(thrownError.category, 'quota_exhausted_error');
    assert.ok(elapsed < 200, `Must fail immediately without backoff delay (elapsed: ${elapsed}ms)`);
  });

  // ==========================================================================
  // SCENARIO 5: Invalid API key (401/403) does not trigger repeated retries
  // ==========================================================================
  it('5. does not retry on permanent authentication or permission errors (HTTP 401/403)', async () => {
    let callCount401 = 0;
    try {
      await executeWithRetry(
        async () => {
          callCount401++;
          const err = new Error('HTTP 401: Invalid API key provided.');
          err.status = 401;
          throw err;
        },
        { maxRetries: 3, baseDelayMs: 20 }
      );
    } catch (err) {
      assert.strictEqual(err.category, 'authentication_error');
      assert.strictEqual(err.isRetryable, false);
    }
    assert.strictEqual(callCount401, 1, 'HTTP 401 must fail immediately with 0 retries');

    let callCount403 = 0;
    try {
      await executeWithRetry(
        async () => {
          callCount403++;
          const err = new Error('HTTP 403: Forbidden - caller does not have permission.');
          err.status = 403;
          throw err;
        },
        { maxRetries: 3, baseDelayMs: 20 }
      );
    } catch (err) {
      assert.strictEqual(err.category, 'authentication_error');
      assert.strictEqual(err.isRetryable, false);
    }
    assert.strictEqual(callCount403, 1, 'HTTP 403 must fail immediately with 0 retries');
  });

  // ==========================================================================
  // SCENARIO 6: Retry budget exhaustion returns structured error
  // ==========================================================================
  it('6. returns structured ProviderError when retry attempts or total time budget are exhausted', async () => {
    let callCount = 0;
    let thrownError;
    try {
      await executeWithRetry(
        async () => {
          callCount++;
          const err = new Error('HTTP 502 Bad Gateway');
          err.status = 502;
          throw err;
        },
        { maxRetries: 2, baseDelayMs: 10, jitterFactor: 0, totalTimeoutMs: 5000 }
      );
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError instanceof ProviderError);
    assert.strictEqual(callCount, 3, 'Initial attempt + 2 retries = 3 calls');
    assert.strictEqual(thrownError.category, 'service_error');

    // Total timeout budget test
    let timeoutCallCount = 0;
    let budgetError;
    try {
      await executeWithRetry(
        async () => {
          timeoutCallCount++;
          const err = new Error('HTTP 503 Overloaded');
          err.status = 503;
          throw err;
        },
        { maxRetries: 10, baseDelayMs: 200, totalTimeoutMs: 50 }
      );
    } catch (err) {
      budgetError = err;
    }

    assert.ok(budgetError);
    assert.strictEqual(budgetError.category, 'retry_budget_exhausted');
  });

  // ==========================================================================
  // SCENARIO 7: Request timeout handling (ECONNRESET, ETIMEDOUT)
  // ==========================================================================
  it('7. classifies connection resets and network timeouts as retryable and recovers', async () => {
    let callCount = 0;
    const testFn = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'reconnected';
    };

    const res = await executeWithRetry(testFn, {
      maxRetries: 2,
      baseDelayMs: 10,
      totalTimeoutMs: 5000,
    });
    assert.strictEqual(res, 'reconnected');
    assert.strictEqual(callCount, 2);
  });

  // ==========================================================================
  // SCENARIO 8: Mid-execution provider failure preserves completed steps
  // ==========================================================================
  it('8. preserves all completed steps, actions, durations, and screenshots when provider fails mid-execution', async () => {
    const plannedObjectives = [
      {
        id: 'obj-1',
        description: 'Add jacket to cart',
        targetBehavior: 'Add item to cart',
      },
      {
        id: 'obj-2',
        description: 'Verify cart contents',
        targetBehavior: 'Check cart',
      },
    ];

    let stepCall = 0;
    const mockSteps = ({ objective }) => {
      if (objective.id === 'obj-1') {
        stepCall++;
        if (stepCall === 1) {
          return {
            thought: 'Click add to cart button',
            action: 'click',
            target: { strategy: 'css', value: '#add-to-cart-sauce-labs-fleece-jacket' },
            expectedOutcome: 'Item added to cart',
          };
        }
        return {
          thought: 'Objective 1 completed successfully',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Jacket added to cart' },
        };
      }
      // Objective 2 triggers provider quota error
      const quotaErr = new Error('Resource has been exhausted (e.g. check quota).');
      quotaErr.status = 429;
      quotaErr.category = 'quota_exhausted_error';
      throw quotaErr;
    };

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/catalog`,
        instructions: 'Add jacket to cart and then verify cart contents.',
      },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockObjectives: plannedObjectives,
        mockSteps,
      }
    );

    // 1. Overall status must be partial (not passed, not crashed)
    assert.strictEqual(report.status, 'partial', 'Must report partial when obj-1 passed but provider halted');

    // 2. All completed steps from obj-1 MUST be preserved
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep, 'Completed click step must be preserved in execution report');
    assert.strictEqual(clickStep.status, 'PASS');
    assert.ok(clickStep.durationMs >= 0);

    // 3. Error step recorded for the failed provider call
    const errStep = report.steps.find((s) => s.action === 'error');
    assert.ok(errStep, 'Error step must be recorded for provider failure');
    assert.strictEqual(errStep.status, 'ERROR');
    assert.match(errStep.actual, /Execution halted: AI provider failed/i);

    // 4. Planner diagnostic reflects the provider halt
    assert.strictEqual(report.planner.executionHalted, true);
    assert.ok(report.planner.haltReason);

    // 5. Coverage and limitations accurately reflects tested vs notTested
    assert.match(report.coverageAndLimitations.tested, /Add jacket to cart/i);
    assert.match(report.coverageAndLimitations.notTested, /Verify cart contents/i);
  });

  // ==========================================================================
  // SCENARIO 9: Completed actions are not replayed after provider failure
  // ==========================================================================
  it('9. never replays already completed actions when execution halts or switches', async () => {
    let clickCount = 0;
    const plannedObjectives = [
      { id: 'obj-1', description: 'Click button once', targetBehavior: 'Action execution' },
      { id: 'obj-2', description: 'Second objective', targetBehavior: 'Subsequent step' },
    ];

    const mockSteps = ({ objective }) => {
      if (objective.id === 'obj-1') {
        clickCount++;
        return {
          thought: 'Conclude step 1',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Done' },
        };
      }
      throw new Error('Provider rate limit reached.');
    };

    const report = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Perform sequence' },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockObjectives: plannedObjectives,
        mockSteps,
      }
    );

    assert.strictEqual(clickCount, 1, 'obj-1 must execute exactly once and never be re-evaluated');
    assert.strictEqual(report.status, 'partial');
  });

  // ==========================================================================
  // SCENARIO 10: Configured provider fallback works without replaying actions
  // ==========================================================================
  it('10. seamlessly fails over to fallback provider on current observation without replaying past actions', async () => {
    const plannedObjectives = [
      { id: 'obj-1', description: 'Step with primary provider', targetBehavior: 'First action' },
      { id: 'obj-2', description: 'Step requiring fallback provider', targetBehavior: 'Second action' },
    ];

    // Primary provider fails on step 2
    let primaryStep = 0;
    const primaryMock = {
      name: 'primary-gemini',
      model: 'gemini-2.5-flash',
      async planObjectives() {
        return { objectives: plannedObjectives };
      },
      async decideNextStep({ objective }) {
        if (objective.id === 'obj-1') {
          return {
            thought: 'Primary successfully completes obj-1',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Primary step verified' },
          };
        }
        // Fail on obj-2
        const err = new Error('Gemini rate limit or quota exceeded.');
        err.status = 429;
        err.category = 'rate_limit_error';
        throw err;
      },
    };

    // Fallback provider receives current observation and concludes obj-2
    let fallbackCalls = 0;
    const fallbackMock = {
      name: 'fallback-openai',
      model: 'gpt-4o-mini',
      async planObjectives() {
        return { objectives: plannedObjectives };
      },
      async decideNextStep({ objective, history }) {
        fallbackCalls++;
        // Verify fallback receives execution history without replaying past actions
        assert.ok(history.length >= 1, 'Fallback provider must receive history of prior completed steps');
        assert.strictEqual(objective.id, 'obj-2', 'Fallback must be called for current unexecuted objective');
        return {
          thought: 'Fallback provider seamlessly concludes obj-2',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Fallback step verified successfully' },
        };
      },
    };

    const report = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Execute multi-step flow with fallback' },
      {
        allowLocalForTesting: true,
        allowMock: false,
        provider: primaryMock,
        fallbackProvider: fallbackMock,
        plannedObjectives,
      }
    );

    assert.strictEqual(fallbackCalls, 1, 'Fallback provider must be invoked for the remaining step');
    assert.strictEqual(report.status, 'passed', 'Test must pass when fallback provider succeeds');
    assert.ok(report.planner.fallbackUsed, 'Planner must record that fallback was used');
    assert.strictEqual(report.planner.fallbackUsed.from, 'primary-gemini');
    assert.strictEqual(report.planner.fallbackUsed.to, 'fallback-openai');
  });

  // ==========================================================================
  // SCENARIO 11: No configured fallback produces clear partial result
  // ==========================================================================
  it('11. produces a clear partial result when no fallback provider is configured', async () => {
    const plannedObjectives = [
      { id: 'obj-1', description: 'First step that passes', targetBehavior: 'Step 1' },
      { id: 'obj-2', description: 'Second step that hits quota', targetBehavior: 'Step 2' },
      { id: 'obj-3', description: 'Third step that gets skipped', targetBehavior: 'Step 3' },
    ];

    const mockSteps = ({ objective }) => {
      if (objective.id === 'obj-1') {
        return {
          thought: 'Pass step 1',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Step 1 passed' },
        };
      }
      throw new Error('429 Resource has been exhausted (quota exceeded)');
    };

    const report = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Test partial execution' },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockObjectives: plannedObjectives,
        mockSteps,
      }
    );

    assert.strictEqual(report.status, 'partial', 'Overall status must be partial');
    assert.strictEqual(report.passedSteps >= 1, true);
    assert.strictEqual(report.skippedSteps >= 1, true);

    const skippedStep = report.steps.find((s) => s.objectiveId === 'obj-3');
    assert.ok(skippedStep);
    assert.strictEqual(skippedStep.status, 'SKIPPED');
    assert.match(skippedStep.actual, /Execution halted because AI provider failed/i);
  });

  // ==========================================================================
  // SCENARIO 12: Unexecuted objectives are not marked PASS
  // ==========================================================================
  it('12. ensures unexecuted objectives are NEVER marked as PASS upon provider failure', async () => {
    const plannedObjectives = [
      { id: 'obj-1', description: 'Initial objective', targetBehavior: 'Action 1' },
      { id: 'obj-2', description: 'Unexecuted objective A', targetBehavior: 'Action 2' },
      { id: 'obj-3', description: 'Unexecuted objective B', targetBehavior: 'Action 3' },
    ];

    const mockSteps = () => {
      const err = new Error('Exceeded your current quota.');
      err.status = 429;
      err.category = 'quota_exhausted_error';
      throw err;
    };

    const report = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Test quota failure from step 1' },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockObjectives: plannedObjectives,
        mockSteps,
      }
    );

    // No objectives succeeded, so final status must be 'error' (NEVER 'passed')
    assert.strictEqual(report.status, 'error');
    assert.strictEqual(report.steps.some((s) => s.objectiveId && s.status === 'PASS'), false, 'No objective must be marked PASS');

    for (const step of report.steps) {
      if (step.objectiveId === 'obj-2' || step.objectiveId === 'obj-3') {
        assert.notStrictEqual(step.status, 'PASS', 'Unexecuted step must never be PASS');
        assert.strictEqual(step.status, 'SKIPPED');
      }
    }
  });

  // ==========================================================================
  // SCENARIO 13: Unverified click outcomes remain unverified
  // ==========================================================================
  it('13. distinguishes verified functional state updates from unverified dead clicks', async () => {
    // 13A: Verified state update on functional button (text changes from "Add to cart" to "Remove", badge to "1")
    const verifiedReport = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Click functional button' },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockSteps: [
          {
            thought: 'Click add to cart to verify state update',
            action: 'click',
            target: { strategy: 'css', value: '#add-to-cart-sauce-labs-fleece-jacket' },
          },
          {
            thought: 'Conclude',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'State verified' },
          },
        ],
      }
    );

    const verifiedClickStep = verifiedReport.steps.find((s) => s.action === 'click');
    assert.ok(verifiedClickStep);
    assert.match(
      verifiedClickStep.actual,
      /Observed state update: button text changed from "Add to cart" to "Remove"/i,
      'Click evidence must explicitly report the verified button text and badge transition'
    );

    // 13B: Dead click on non-functional button produces no functional change and is diagnosed as such
    const deadClickReport = await executeAiAgent(
      { url: `${baseUrl}/catalog`, instructions: 'Click non-functional button' },
      {
        allowLocalForTesting: true,
        allowMock: true,
        mockSteps: [
          {
            thought: 'Click dead button',
            action: 'click',
            target: { strategy: 'css', value: '#dead-btn' },
          },
          {
            thought: 'Conclude',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Done' },
          },
        ],
      }
    );

    const deadClickStep = deadClickReport.steps.find((s) => s.action === 'click');
    assert.ok(deadClickStep);
    assert.match(
      deadClickStep.actual,
      /no-op\/dead click|no observable functional change/i,
      'Dead click must be reported as having no observable state transition'
    );
  });

  // ==========================================================================
  // SCENARIO 14: Existing provider security and credential redaction remain intact
  // ==========================================================================
  it('14. guarantees API keys, passwords, and tokens are strictly sanitized in error messages and logs', () => {
    const rawApiKey = 'AIzaSyA_TEST_SECRET_KEY_12345';
    const rawPassword = 'SuperSecretUserPassword999!';
    const rawToken = 'sk-proj-OPENAI_SECRET_TOKEN_XYZ';

    const leakedString = `Error connecting with API key ${rawApiKey} and password ${rawPassword} or token ${rawToken}`;

    const sanitized = sanitizeErrorString(leakedString, [rawApiKey, rawPassword, rawToken]);

    assert.ok(!sanitized.includes(rawApiKey), 'Sanitized string must not contain raw API key');
    assert.ok(!sanitized.includes(rawPassword), 'Sanitized string must not contain raw user password');
    assert.ok(!sanitized.includes(rawToken), 'Sanitized string must not contain raw OpenAI token');
    assert.match(sanitized, /\[REDACTED\]/);

    // redactSecrets general text scanner
    const textWithBearer = 'Authorization: Bearer sk-1234567890abcdef1234567890abcdef';
    const redactedBearer = redactSecrets(textWithBearer);
    assert.ok(!redactedBearer.includes('sk-1234567890abcdef1234567890abcdef'));
    assert.match(redactedBearer, /Bearer \[REDACTED\]/);
  });
});
