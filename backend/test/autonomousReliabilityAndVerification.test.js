import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executeAiAgent } from '../src/services/aiAgentService.js';
import { MockProvider } from '../src/services/aiProvider/mockProvider.js';

describe('Phase 4.7: Autonomous Testing Reliability and Verification Accuracy Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // ----------------------------------------------------------------------
      // 1. Ambiguous Controls Fixture: Multiple identical buttons without context
      // ----------------------------------------------------------------------
      if (url.pathname === '/ambiguous-controls') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Ambiguity Fixture</title></head>
            <body>
              <h1>Ambiguous Actions</h1>
              <div class="action-box">
                <button class="danger-btn">Delete Account</button>
              </div>
              <div class="action-box">
                <button class="danger-btn">Delete Account</button>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 2. Contextual Disambiguation Fixture: Identical buttons in distinct cards
      // ----------------------------------------------------------------------
      if (url.pathname === '/contextual-cards') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Pricing Plans</title></head>
            <body>
              <h1>Choose Your Subscription</h1>
              <div class="plans-container">
                <article class="plan-card" id="starter-card">
                  <h2>Starter Tier</h2>
                  <p>$19 per month for small teams</p>
                  <button class="select-btn" onclick="selectTier('Starter')">Select Plan</button>
                </article>
                <article class="plan-card" id="enterprise-card">
                  <h2>Enterprise Tier</h2>
                  <p>$99 per month with dedicated support and custom features</p>
                  <button class="select-btn" onclick="selectTier('Enterprise')">Select Plan</button>
                </article>
              </div>
              <div id="selection-banner" style="display:none;" role="status"></div>
              <script>
                function selectTier(name) {
                  const b = document.getElementById('selection-banner');
                  b.style.display = 'block';
                  b.innerText = name + ' Plan selected successfully!';
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 3. Misleading Success Notification Fixture: Toast says success, but container empty
      // ----------------------------------------------------------------------
      if (url.pathname === '/misleading-notification') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Catalog Store</title></head>
            <body>
              <h1>Inventory Store</h1>
              <button id="add-item-btn" onclick="showFalseToast()">Add Premium Monitor to Cart</button>
              <div id="toast-container"></div>
              <div id="cart-drawer">
                <h2>Your Shopping Cart</h2>
                <div class="cart-empty" data-testid="empty-state">Your cart is empty (0 items)</div>
                <table class="cart" data-testid="cart-table">
                  <tbody></tbody>
                </table>
              </div>
              <script>
                function showFalseToast() {
                  const toast = document.createElement('div');
                  toast.className = 'toast alert-success';
                  toast.setAttribute('role', 'status');
                  toast.innerText = 'Item successfully added to cart!';
                  document.getElementById('toast-container').appendChild(toast);
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 4. Dead Click / No-Op Fixture: Button click produces no change
      // ----------------------------------------------------------------------
      if (url.pathname === '/dead-click') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Unresponsive Page</title></head>
            <body>
              <h1>Support Desk</h1>
              <button id="unresponsive-btn">Submit Support Ticket</button>
              <p id="static-notice">Tickets are reviewed during working hours.</p>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 5. Empty Results Fixture
      // ----------------------------------------------------------------------
      if (url.pathname === '/search-empty') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Product Search</title></head>
            <body>
              <h1>Catalog Search</h1>
              <form onsubmit="event.preventDefault(); showEmpty();">
                <input type="text" id="query-input" placeholder="Search catalog..." />
                <button type="submit" id="search-btn">Search</button>
              </form>
              <div id="results-area">
                <div class="no-results" data-testid="no-results">No results found for your query.</div>
              </div>
              <script>
                function showEmpty() {
                  document.getElementById('results-area').innerHTML = '<div class="no-results">No results found for your query.</div>';
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 6. Delayed Rendering Fixture: Spinner settles into content
      // ----------------------------------------------------------------------
      if (url.pathname === '/delayed-render') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Async Analytics</title></head>
            <body>
              <h1>Performance Dashboard</h1>
              <div id="loader" class="spinner" aria-busy="true">Loading analytics data...</div>
              <div id="content" style="display:none;">
                <p id="metric-report">Q3 Performance: All systems operational</p>
              </div>
              <script>
                setTimeout(() => {
                  document.getElementById('loader').remove();
                  document.getElementById('content').style.display = 'block';
                }, 500);
              </script>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 7. Form Submission with Validation Errors Fixture
      // ----------------------------------------------------------------------
      if (url.pathname === '/form-validation') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Registration Form</title></head>
            <body>
              <h1>Create an Account</h1>
              <form id="reg-form" onsubmit="event.preventDefault(); validateForm();">
                <label for="email-field">Email Address</label>
                <input type="email" id="email-field" name="email" />
                <div id="email-err" class="error-message" style="display:none;" role="alert">Valid email address is required</div>

                <label for="pass-field">Password</label>
                <input type="password" id="pass-field" name="password" />

                <button type="submit" id="submit-reg-btn">Register</button>
              </form>
              <div id="success-banner" style="display:none;">Registration Complete!</div>
              <script>
                function validateForm() {
                  const val = document.getElementById('email-field').value;
                  if (!val || !val.includes('@')) {
                    document.getElementById('email-err').style.display = 'block';
                  } else {
                    document.getElementById('email-err').style.display = 'none';
                    document.getElementById('reg-form').style.display = 'none';
                    document.getElementById('success-banner').style.display = 'block';
                  }
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // 8. Adaptive Recovery Fixture: First locator fails, alternative exists
      // ----------------------------------------------------------------------
      if (url.pathname === '/adaptive-recovery') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Job Portal</title></head>
            <body>
              <h1>Software Engineer Role</h1>
              <p>Remote - Full Time</p>
              <button id="apply-now-btn" class="primary-btn" onclick="document.getElementById('applied-msg').style.display='block';">Apply Now</button>
              <div id="applied-msg" style="display:none;" role="status">Application Submitted Successfully!</div>
            </body>
          </html>
        `);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ==========================================================================
  // Test 1: Ambiguous Controls Detection (Refuses arbitrary selection)
  // ==========================================================================
  it('1. detects multiple identical ambiguous controls and blocks rather than selecting arbitrarily', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Delete Account button to test account deletion',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Delete Account' },
        expectedOutcome: 'Account deletion prompt shown',
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/ambiguous-controls`,
        instructions: 'Click the Delete Account button and verify confirmation',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    // Should be blocked because there are 2 identical buttons without distinguishing context
    assert.strictEqual(report.status, 'blocked', `Expected status "blocked" for ambiguous controls, got: ${report.status}`);
    assert.match(
      report.blockedReason || report.failure?.description || '',
      /ambiguous/i,
      'Failure reason should clearly mention ambiguous controls'
    );
  });

  // ==========================================================================
  // Test 2: Contextual Disambiguation via Card / Container Context
  // ==========================================================================
  it('2. successfully disambiguates identical buttons using surrounding card and container context', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Select the Enterprise Tier plan by clicking its Select Plan button inside the Enterprise card',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Select Plan' },
        expectedOutcome: 'Enterprise Plan selected',
      },
      {
        thought: 'Verify that Enterprise Plan selected banner is displayed',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Enterprise Plan was successfully disambiguated, clicked, and banner verified.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/contextual-cards`,
        instructions: 'Select the Enterprise Tier subscription plan and verify confirmation',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass with contextual disambiguation, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep, 'Click step should exist');
    assert.strictEqual(clickStep.status, 'PASS', 'Click step should pass');
  });

  // ==========================================================================
  // Test 3: Misleading Success Notification Guard (Persistent state empty)
  // ==========================================================================
  it('3. rejects false-positive PASS when toast reports success but persistent state container is empty', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Add Premium Monitor to Cart button',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Add Premium Monitor to Cart' },
        expectedOutcome: 'Item added to shopping cart',
      },
      {
        // Model attempts to falsely conclude PASS because it saw the toast
        thought: 'I saw the success toast notification so I will conclude PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Success notification was observed on page.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/misleading-notification`,
        instructions: 'Add Premium Monitor to cart and verify cart contents',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    // Verification guard should catch the empty container and override PASS to FAIL
    assert.strictEqual(report.status, 'failed', `Expected failed due to empty cart despite toast, got: ${report.status}`);
    const conclusionStep = report.steps.find((s) => s.action === 'conclude');
    assert.ok(conclusionStep, 'Conclusion step should exist');
    assert.strictEqual(conclusionStep.status, 'FAIL', 'Conclusion status should be FAIL');
    assert.match(conclusionStep.actual, /misleading|empty/i, 'Reason should report misleading notification or empty state');
  });

  // ==========================================================================
  // Test 4: Dead Click / No-Op Detection
  // ==========================================================================
  it('4. detects dead clicks that produce no functional change and prevents false-positive PASS', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Submit Support Ticket button',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Submit Support Ticket' },
        expectedOutcome: 'Ticket created confirmation',
      },
      {
        // Model tries to conclude PASS immediately after a dead click
        thought: 'Button was clicked, concluding PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Button click dispatched.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/dead-click`,
        instructions: 'Submit support ticket and verify ticket status',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'failed', `Expected failed due to dead click, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep, 'Click step should exist');
    assert.match(clickStep.actual, /dead click|no-op|no observable/i, 'Click step should indicate dead click');
  });

  // ==========================================================================
  // Test 5: Empty Search Results Guard
  // ==========================================================================
  it('5. prevents false-positive PASS when a search returns empty results ("No results found")', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Conclude PASS after search',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Search completed.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/search-empty`,
        instructions: 'Search for gadget products in the catalog and verify results',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'failed', `Expected failed due to empty search results, got: ${report.status}`);
    const conclusionStep = report.steps.find((s) => s.action === 'conclude');
    assert.ok(conclusionStep, 'Conclusion step should exist');
    assert.strictEqual(conclusionStep.status, 'FAIL', 'Conclusion status should be FAIL');
    assert.match(conclusionStep.actual, /empty results|no results found/i, 'Should report empty results found');
  });

  // ==========================================================================
  // Test 6: Delayed Rendering and Loading Indicator Settlement
  // ==========================================================================
  it('6. waits for loading indicator to settle and verifies asynchronously rendered content', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Verify that metric report has rendered after loader settles',
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Q3 Performance: All systems operational' },
        expectedOutcome: 'Metric report is visible',
      },
      {
        thought: 'Conclude after verifying rendered analytics',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Analytics report verified successfully after loader settled.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/delayed-render`,
        instructions: 'View dashboard and verify Q3 performance metric report',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass after waiting for loader, got: ${report.status}`);
    const assertStep = report.steps.find((s) => s.action === 'assertVisible');
    assert.ok(assertStep, 'Assert step should exist');
    assert.strictEqual(assertStep.status, 'PASS', 'Assert step should pass');
  });

  // ==========================================================================
  // Test 7: Form Submission with Active Validation Errors
  // ==========================================================================
  it('7. detects active form validation errors and rejects false-positive PASS on valid form submissions', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Register button with empty form to test submit',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Register' },
        expectedOutcome: 'Form submitted',
      },
      {
        thought: 'Form button was clicked, conclude PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Registration submitted.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/form-validation`,
        instructions: 'Submit valid registration form and verify account creation',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'failed', `Expected failed due to validation errors, got: ${report.status}`);
    const conclusionStep = report.steps.find((s) => s.action === 'conclude');
    assert.ok(conclusionStep, 'Conclusion step should exist');
    assert.strictEqual(conclusionStep.status, 'FAIL', 'Conclusion status should be FAIL');
    assert.match(conclusionStep.actual, /validation error/i, 'Should cite form validation errors');
  });

  // ==========================================================================
  // Test 8: Adaptive Recovery when Action Fails
  // ==========================================================================
  it('8. executes adaptive recovery when an action fails by refreshing state and succeeding with alternative action', async () => {
    let callCount = 0;
    const adaptiveProvider = {
      name: 'adaptive-mock',
      model: 'adaptive-mock-agent',
      async planObjectives() {
        return {
          objectives: [
            {
              id: 'obj-1',
              description: 'Apply for software engineer job and verify confirmation',
              targetBehavior: 'Submit application via apply button',
              expectedOutcome: 'Confirmation displayed',
              preconditions: [],
              safetyRestrictions: [],
            },
          ],
        };
      },
      async decideNextStep({ history = [] }) {
        callCount++;
        // Step 1: Model initially guesses wrong locator name "Nonexistent Submit Application" which doesn't exist
        if (callCount === 1) {
          return {
            thought: 'Try clicking Nonexistent Submit Application button',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Nonexistent Submit Application' },
            expectedOutcome: 'Application submitted',
          };
        }

        // Step 2: Adaptive recovery initiated! History shows step 1 failed.
        // Model inspects refreshed state and chooses actual button "Apply Now"
        if (callCount === 2) {
          return {
            thought: 'Previous attempt failed. Refreshing locator to match available "Apply Now" button',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Apply Now' },
            expectedOutcome: 'Application submitted',
          };
        }

        // Step 3: Conclude PASS after successful interaction
        return {
          thought: 'Application submitted message visible, conclude PASS',
          action: 'conclude',
          conclude: {
            outcome: 'PASS',
            reasoning: 'Application submitted successfully after adapting locator.',
          },
        };
      },
    };

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/adaptive-recovery`,
        instructions: 'Apply for software engineer job and verify confirmation',
      },
      {
        provider: adaptiveProvider,
        allowLocalForTesting: true,
        maxSteps: 6,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected adaptive recovery to succeed, got: ${report.status}`);
    const failedStep = report.steps.find((s) => s.status === 'FAIL');
    assert.ok(failedStep, 'Should have recorded the initial failed step');
    assert.match(failedStep.actual, /Adaptive recovery/i, 'Failed step should record adaptive recovery message');

    const passClickStep = report.steps.find((s) => s.status === 'PASS' && s.action === 'click');
    assert.ok(passClickStep, 'Second adapted click step should have passed');
  });
});
