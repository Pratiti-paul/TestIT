import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  executeAiAgent,
  checkObjectiveDependencies,
  isLoginVerificationObjective,
  requiresValidCredentials,
  requiresAuthenticatedSession,
} from '../src/services/aiAgentService.js';
import { verifyDateAndWeekdaySync, extractDateTokens } from '../src/services/verifiers/dateVerifier.js';
import { verifyCalculation, verifySorting } from '../src/services/verifiers/calculationVerifier.js';
import { validateAgentDecision, getMissingProviderReport } from '../src/services/aiProvider/index.js';
import { verifyAuthenticationSuccess } from '../src/services/verifiers/authVerifier.js';

describe('Autonomous AI QA Agent Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/calendar-sync') {
        const today = new Date();
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const currentDay = days[today.getDay()];
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Calendar & Schedule Portal</title></head>
            <body>
              <header><span class="date-header">Today</span></header>
              <div class="calendar-ribbon">
                ${days
                  .map(
                    (d) =>
                      `<button class="${d === currentDay ? 'bg-primary active' : 'bg-muted'}" ${
                        d === currentDay ? 'aria-selected="true" aria-current="date"' : ''
                      }><span>${d}</span></button>`
                  )
                  .join('')}
              </div>
              <div class="schedule">
                <h3>Breakfast</h3>
                <p>07:30 - 09:30 AM</p>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/dashboard-data') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Sales Analytics Dashboard</title></head>
            <body>
              <h1>Dashboard Overview</h1>
              <div class="stats-card">
                <span class="stat-label">Total Revenue</span>
                <span class="stat-value">$350.00</span>
              </div>
              <table id="transactions-table">
                <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
                <tbody>
                  <tr class="item-row"><td>Widget Pro</td><td class="qty">2</td><td class="price">$100.00</td></tr>
                  <tr class="item-row"><td>Basic Plan</td><td class="qty">1</td><td class="price">$150.00</td></tr>
                </tbody>
              </table>
            </body>
          </html>
        `);
      } else if (url.pathname === '/persisted-notes') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Persisted Notes</title></head>
            <body>
              <h2>My Notes</h2>
              <input id="note-input" placeholder="Enter note title..." />
              <button id="add-note-btn" onclick="saveNote()">Add Note</button>
              <ul id="notes-list"></ul>
              <script>
                function render() {
                  const list = document.getElementById('notes-list');
                  list.innerHTML = '';
                  const saved = JSON.parse(localStorage.getItem('notes') || '[]');
                  saved.forEach(n => {
                    const li = document.createElement('li');
                    li.textContent = n;
                    list.appendChild(li);
                  });
                }
                function saveNote() {
                  const val = document.getElementById('note-input').value.trim();
                  if (!val) return;
                  const current = JSON.parse(localStorage.getItem('notes') || '[]');
                  current.push(val);
                  localStorage.setItem('notes', JSON.stringify(current));
                  document.getElementById('note-input').value = '';
                  render();
                }
                render();
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/registration-form') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>User Registration</title></head>
            <body>
              <h2>Create an Account</h2>
              <form id="reg-form" onsubmit="handleRegister(event)">
                <input id="name" name="name" placeholder="Full Name" required />
                <input id="email" name="email" type="email" placeholder="Email Address" required />
                <input id="password" name="password" type="password" placeholder="Password" required />
                <button type="submit" id="submit-reg">Register</button>
              </form>
              <div id="error-msg" style="display:none; color:red;"></div>
              <div id="success-msg" style="display:none; color:green;">Account registered successfully</div>
              <script>
                function handleRegister(e) {
                  e.preventDefault();
                  const email = document.getElementById('email').value.trim();
                  const password = document.getElementById('password').value;
                  const errEl = document.getElementById('error-msg');
                  const succEl = document.getElementById('success-msg');
                  errEl.style.display = 'none';
                  succEl.style.display = 'none';

                  if (email === 'existing@example.com') {
                    errEl.textContent = 'Email is already registered. Please choose another email.';
                    errEl.style.display = 'block';
                    return;
                  }
                  if (password.length < 6) {
                    errEl.textContent = 'Password must be at least 6 characters.';
                    errEl.style.display = 'block';
                    return;
                  }
                  succEl.style.display = 'block';
                }
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/auth-required-profile') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Login Required</title></head>
            <body>
              <div id="login-barrier">
                <h2>Please Log In to View Account Details</h2>
                <form id="auth-form">
                  <input name="user" placeholder="Username" />
                  <input name="pass" type="password" placeholder="Password" />
                  <button type="submit">Sign In</button>
                </form>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/login-test-portal') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Portal Login</title></head>
            <body>
              <h2>Account Login</h2>
              <form id="login-form" onsubmit="handleAuth(event)">
                <input id="username" name="user" placeholder="Username" required />
                <input id="password" name="pass" type="password" placeholder="Password" required />
                <button type="submit" id="login-btn">Sign In</button>
              </form>
              <div id="error-msg" style="display:none; color:red;">Invalid username or password</div>
              <div id="user-dashboard" style="display:none;">
                <h3>Welcome, Member!</h3>
                <p id="user-display"></p>
                <a href="#orders" id="view-orders">My Order History</a>
              </div>
              <script>
                function handleAuth(e) {
                  e.preventDefault();
                  const u = document.getElementById('username').value.trim();
                  const p = document.getElementById('password').value;
                  const err = document.getElementById('error-msg');
                  const dash = document.getElementById('user-dashboard');
                  err.style.display = 'none';

                  if ((u === 'validuser' || u === 'abc@gmail.com') && (p === 'validpass123' || p === 'SuperSecret123!@#')) {
                    document.getElementById('login-form').style.display = 'none';
                    document.getElementById('user-display').textContent = 'Logged in as ' + u;
                    dash.style.display = 'block';
                    localStorage.setItem('auth_token', 'valid_token_789');
                  } else {
                    err.style.display = 'block';
                  }
                }
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/public-store') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Health Pharmacy Store</title></head>
            <body>
              <h1>Health Pharmacy Online</h1>
              <input id="store-search" placeholder="Search for medicine..." />
              <button id="search-btn" onclick="doSearch()">Search</button>
              <div id="results" style="display:none;">
                <div class="product-item">
                  <h3>Paracetamol 500mg</h3>
                  <button id="add-to-cart-btn" onclick="addToCart()">Add to Cart</button>
                </div>
              </div>
              <div id="cart-msg" style="display:none; color:green;">Added to Cart: Paracetamol 500mg</div>
              <script>
                function doSearch() {
                  document.getElementById('results').style.display = 'block';
                }
                function addToCart() {
                  document.getElementById('cart-msg').style.display = 'block';
                }
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/store-with-protected-checkout') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Marketplace Store</title></head>
            <body>
              <h1>Marketplace Store</h1>
              <a href="/login-test-portal?redirect=/protected-checkout" id="checkout-link">Proceed to Checkout</a>
            </body>
          </html>
        `);
      } else if (url.pathname === '/store-with-protected-orders') {
        res.writeHead(302, { Location: '/login-test-portal?redirect=/orders' });
        res.end();
      } else if (url.pathname === '/session-expiration-portal') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Account Portal</title></head>
            <body>
              <h1>Member Portal</h1>
              <a href="/trigger-session-expired" id="view-statement-btn">View Monthly Statement</a>
            </body>
          </html>
        `);
      } else if (url.pathname === '/trigger-session-expired') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Session Expired</title></head>
            <body>
              <div id="session-expired-banner">
                <h2>Session Expired: Please log in again</h2>
                <form id="expired-login-form" onsubmit="handleExpiredAuth(event)">
                  <input id="exp-user" name="user" placeholder="Username" required />
                  <input id="exp-pass" name="pass" type="password" placeholder="Password" required />
                  <button type="submit" id="exp-submit">Sign In</button>
                </form>
              </div>
              <div id="statement-view" style="display:none;">
                <h3>Monthly Statement: October 2026</h3>
                <p>Status: All accounts settled</p>
              </div>
              <script>
                function handleExpiredAuth(e) {
                  e.preventDefault();
                  const u = document.getElementById('exp-user').value.trim();
                  const p = document.getElementById('exp-pass').value;
                  if ((u === 'validuser' || u === 'abc@gmail.com') && (p === 'validpass123' || p === 'SuperSecret123!@#')) {
                    document.getElementById('session-expired-banner').style.display = 'none';
                    document.getElementById('statement-view').style.display = 'block';
                    localStorage.setItem('auth_token', 'restored_token_123');
                  }
                }
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/async-login-portal') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Async Auth Portal</title></head>
            <body>
              <div id="login-card">
                <h2>Secure Login</h2>
                <div id="error-box" class="auth-error-message" style="display:none; color:red;"></div>
                <form id="async-form" onsubmit="handleAsyncLogin(event)">
                  <input id="email-field" type="email" name="email" placeholder="Email" required />
                  <input id="password-field" type="password" name="password" placeholder="Password" required />
                  <button type="submit" id="submit-btn" data-testid="login-submit">Login</button>
                </form>
              </div>
              <div id="dashboard" style="display:none;">
                <h2>Welcome Back</h2>
                <p id="user-greeting">Welcome user</p>
                <a href="/logout" id="logout-btn">Log out</a>
                <div id="protected-cart">Cart Items</div>
              </div>
              <script>
                function handleAsyncLogin(e) {
                  e.preventDefault();
                  const btn = document.getElementById('submit-btn');
                  const errBox = document.getElementById('error-box');
                  errBox.style.display = 'none';
                  errBox.textContent = '';
                  btn.disabled = true;
                  btn.textContent = 'Logging in...';

                  const email = document.getElementById('email-field').value.trim();
                  const pass = document.getElementById('password-field').value;

                  setTimeout(() => {
                    if (email === 'abc@gmail.com' && pass === 'ValidPassword123!') {
                      document.getElementById('login-card').style.display = 'none';
                      document.getElementById('dashboard').style.display = 'block';
                      document.getElementById('user-greeting').textContent = 'Welcome ' + email;
                      localStorage.setItem('token', 'jwt_async_token_123');
                    } else {
                      btn.disabled = false;
                      btn.textContent = 'Login';
                      errBox.textContent = 'Invalid email or password';
                      errBox.style.display = 'block';
                    }
                  }, 1200);
                }
              </script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. Verifiers: Date, Math, and Schema Integrity', () => {
    it('correctly extracts dates, formats, and weekdays from text strings', () => {
      const t1 = extractDateTokens('Today is Thursday, October 29, 2026');
      assert.equal(t1.weekday?.full, 'Thursday');
      assert.equal(t1.parsedDate?.getUTCFullYear(), 2026);
      assert.equal(t1.parsedDate?.getUTCMonth(), 9); // October (0-based)
      assert.equal(t1.parsedDate?.getUTCDate(), 29);

      const t2 = extractDateTokens('Active: 2026-10-29');
      assert.equal(t2.dateStr, '2026-10-29');
      assert.equal(t2.parsedDate?.getUTCDay(), 4); // Thursday is 4
    });

    it('independently computes and verifies calculation sums and sorting', () => {
      const items = [
        { priceText: '$100.00', quantityText: '2' },
        { priceText: '$150.00', quantityText: '1' },
      ];
      const res = verifyCalculation(items, '$350.00');
      assert.equal(res.pass, true);
      assert.equal(res.expectedTotal, 350);

      const failRes = verifyCalculation(items, '$400.00');
      assert.equal(failRes.pass, false);

      const sortedNumbers = verifySorting(['10', '25', '100'], 'asc', 'number');
      assert.equal(sortedNumbers.isSorted, true);

      const unsortedNumbers = verifySorting(['100', '25', '10'], 'asc', 'number');
      assert.equal(unsortedNumbers.isSorted, false);
    });

    it('strictly validates agent decision schemas and catches malformed actions', () => {
      const validClick = validateAgentDecision({
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Submit' },
      });
      assert.equal(validClick.valid, true);

      const invalidAction = validateAgentDecision({ action: 'executeScript' });
      assert.equal(invalidAction.valid, false);
      assert.match(invalidAction.error, /invalid/i);

      const missingTarget = validateAgentDecision({ action: 'click' });
      assert.equal(missingTarget.valid, false);

      const validConclude = validateAgentDecision({
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'All steps verified' },
      });
      assert.equal(validConclude.valid, true);
    });

    it('returns explicit error notice when no AI provider is configured', () => {
      const report = getMissingProviderReport('https://example.com', 'Test my new feature');
      assert.equal(report.status, 'blocked');
      assert.match(report.blockedReason, /GEMINI_API_KEY/i);
      assert.equal(report.planner.aiConfigured, false);
    });
  });

  describe('2. Autonomous Agent Loop Execution', () => {
    it('executes unseen objective: verify date and weekday synchronization', async () => {
      const mockSteps = [
        {
          thought: 'Assert active day and date synchronization with reference clock',
          action: 'assertDateSync',
          expectedOutcome: 'Displayed active day corresponds to actual current day',
        },
        {
          thought: 'Synchronization verified; conclude test successfully',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Date synchronization verified with evidence.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Check whether the displayed weekday matches the date.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.ok(report.steps.length >= 2);
      const syncStep = report.steps.find((s) => s.action === 'assertDateSync');
      assert.ok(syncStep);
      assert.equal(syncStep.status, 'PASS');
      assert.match(syncStep.actual, /correctly synchronized with system date/i);
    });

    it('executes unseen objective: test registration form with duplicate email', async () => {
      const mockSteps = [
        {
          thought: 'Fill name field',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Full Name' },
          value: 'Jane Doe',
          expectedOutcome: 'Name field filled',
        },
        {
          thought: 'Fill email field with existing email to verify duplicate handling',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email Address' },
          value: 'existing@example.com',
          expectedOutcome: 'Email field filled',
        },
        {
          thought: 'Fill password field',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'secret123',
          expectedOutcome: 'Password filled',
        },
        {
          thought: 'Submit registration form',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Register' },
          expectedOutcome: 'Form submitted and error message displayed',
        },
        {
          thought: 'Verify duplicate email error message is visible',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Email is already registered' },
          expectedOutcome: 'Error message is visible',
        },
        {
          thought: 'Conclude registration validation test as passed',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Duplicate email error handled and verified.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/registration-form`,
          instructions: 'Test the registration form, including invalid inputs and duplicate email handling.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      const errorStep = report.steps.find((s) => s.action === 'assertVisible');
      assert.ok(errorStep);
      assert.equal(errorStep.status, 'PASS');
    });

    it('executes unseen objective: create record and verify state persists across reload', async () => {
      const mockSteps = [
        {
          thought: 'Fill new note title',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Enter note title...' },
          value: 'Meeting at 3PM',
          expectedOutcome: 'Input filled',
        },
        {
          thought: 'Click Add Note button',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Add Note' },
          expectedOutcome: 'Note added to DOM list',
        },
        {
          thought: 'Reload page to test persistence',
          action: 'refresh',
          expectedOutcome: 'Page reloaded',
        },
        {
          thought: 'Verify note item persisted after page reload',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Meeting at 3PM' },
          expectedOutcome: 'Saved note is visible in list after reload',
        },
        {
          thought: 'Conclude persistence test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Data persisted across page reload.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/persisted-notes`,
          instructions: 'Create a record, refresh the page, and verify the changes persist.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      const verifyStep = report.steps.find((s) => s.action === 'assertVisible');
      assert.ok(verifyStep);
      assert.equal(verifyStep.status, 'PASS');
    });

    it('correctly reports FAIL when an assertion expectation is violated', async () => {
      const mockSteps = [
        {
          thought: 'Assert an element that does not exist',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Nonexistent Heading That Violates Expectation' },
          expectedOutcome: 'Heading is visible',
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/dashboard-data`,
          instructions: 'Verify that nonexistent element is present',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
          stepTimeoutMs: 1000,
        }
      );

      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 1);
      assert.ok(report.failure);
      assert.match(report.failure.description, /Verification failed/i);
    });

    it('reports BLOCKED when an unauthenticated page requires credentials', async () => {
      const mockSteps = [
        {
          thought: 'Observe login barrier on protected profile',
          action: 'conclude',
          conclude: {
            outcome: 'BLOCKED',
            reasoning:
              'Authentication prerequisite missing: Target page is a login barrier requiring test account credentials.',
          },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/auth-required-profile`,
          instructions: 'Inspect user profile details',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
        }
      );

      assert.equal(report.status, 'blocked');
      assert.match(report.blockedReason, /Authentication prerequisite/i);
    });

    it('detects agent loops and halts execution safely', async () => {
      // Intentionally repeating the same action 3 times
      const repeatedAction = {
        thought: 'Clicking the same button repeatedly',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Add Note' },
        expectedOutcome: 'Button clicked',
      };

      const mockSteps = [repeatedAction, repeatedAction, repeatedAction, repeatedAction];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/persisted-notes`,
          instructions: 'Test loop detection',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockSteps,
        }
      );

      assert.equal(report.status, 'blocked');
      assert.match(report.blockedReason, /Agent loop detected/i);
    });
  });

  describe('3. Multi-Objective Continuation & Dependency Handling', () => {
    it('1. continues to a subsequent independent objective after an earlier objective fails', async () => {
      const mockObjectives = [
        {
          id: 'obj-1',
          description: 'Verify nonexistent promotional banner is present',
          targetBehavior: 'Promotional banner assertion',
          expectedOutcome: 'Promotional banner is visible',
        },
        {
          id: 'obj-2',
          description: 'Check whether the displayed weekday matches the date',
          targetBehavior: 'Date synchronization',
          expectedOutcome: 'Active day corresponds to system date',
        },
      ];

      const mockSteps = ({ objective, stepNumber }) => {
        if (objective.id === 'obj-1') {
          return {
            thought: 'Assert nonexistent promotional banner to test failure handling',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'Nonexistent Special Promo 9999' },
            expectedOutcome: 'Promo banner is visible',
          };
        }
        if (objective.id === 'obj-2') {
          if (stepNumber <= 2) {
            return {
              thought: 'Assert date synchronization with live calendar',
              action: 'assertDateSync',
              expectedOutcome: 'Date is synchronized with system clock',
            };
          }
          return {
            thought: 'Conclude date verification',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Date synchronization successfully verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Check promo banner and verify date synchronization.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
          stepTimeoutMs: 1000,
        }
      );

      // Status must remain 'failed' because obj-1 failed (never overwritten by obj-2 passing)
      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 1);
      assert.ok(report.passedSteps >= 1);

      // Both objectives must be represented in steps
      const failedStep = report.steps.find((s) => s.status === 'FAIL' && s.objectiveId === 'obj-1');
      assert.ok(failedStep, 'Objective 1 failure must be recorded');
      assert.match(failedStep.actual, /Nonexistent Special Promo/i);

      const passedStep = report.steps.find((s) => s.status === 'PASS' && s.objectiveId === 'obj-2');
      assert.ok(passedStep, 'Objective 2 passed step must be recorded');

      // Failure detail is preserved from the failed objective
      assert.ok(report.failure);
      assert.match(report.failure.description, /Verification failed/i);

      // Coverage reflects both tested objectives
      assert.match(report.coverageAndLimitations.tested, /Verify nonexistent promotional banner/i);
      assert.match(report.coverageAndLimitations.tested, /Check whether the displayed weekday/i);
    });

    it('2. skips dependent objectives when an authentication prerequisite fails while continuing independent objectives', async () => {
      const mockObjectives = [
        {
          id: 'obj-auth',
          description: 'Attempt login and verify whether authentication succeeds',
          targetBehavior: 'Authentication check',
          isAuthGate: true,
        },
        {
          id: 'obj-profile',
          description: 'Inspect private user account profile and order history',
          targetBehavior: 'Private profile inspection',
          requiresAuth: true,
        },
        {
          id: 'obj-calendar',
          description: 'Check whether the displayed weekday matches the calendar date',
          targetBehavior: 'Calendar synchronization',
        },
      ];

      const mockSteps = ({ objective, stepNumber }) => {
        if (objective.id === 'obj-auth') {
          return {
            thought: 'Simulate failed authentication attempt by asserting missing login success banner',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'Welcome Back Authenticated User Dashboard' },
            expectedOutcome: 'Logged-in dashboard is visible',
          };
        }
        if (objective.id === 'obj-calendar') {
          if (stepNumber <= 2) {
            return {
              thought: 'Verify active day synchronization independently',
              action: 'assertDateSync',
              expectedOutcome: 'Date matches current day',
            };
          }
          return {
            thought: 'Conclude calendar check as passed',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Calendar verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Login to portal, inspect profile, and check calendar date.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
          stepTimeoutMs: 1000,
        }
      );

      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 1);
      assert.equal(report.skippedSteps, 1);
      assert.ok(report.passedSteps >= 1);

      // obj-profile must be marked SKIPPED with clear explanation
      const skippedStep = report.steps.find((s) => s.objectiveId === 'obj-profile');
      assert.ok(skippedStep, 'Dependent objective step must exist with SKIPPED status');
      assert.equal(skippedStep.status, 'SKIPPED');
      assert.match(skippedStep.actual, /Requires an authenticated session, but earlier authentication verification failed/i);

      // obj-calendar must be executed independently and PASS
      const calendarStep = report.steps.find((s) => s.objectiveId === 'obj-calendar');
      assert.ok(calendarStep, 'Independent calendar objective step must exist with PASS status');
      assert.equal(calendarStep.status, 'PASS');

      // Coverage reflects tested vs notTested
      assert.match(report.coverageAndLimitations.tested, /Attempt login/i);
      assert.match(report.coverageAndLimitations.notTested, /Inspect private user account profile.*\(SKIPPED\)/i);
    });

    it('3. preserves results when multiple independent objectives fail', async () => {
      const mockObjectives = [
        {
          id: 'obj-fail-1',
          description: 'Assert missing Header Element A',
          targetBehavior: 'Header check',
        },
        {
          id: 'obj-fail-2',
          description: 'Assert missing Footer Element B',
          targetBehavior: 'Footer check',
        },
      ];

      const mockSteps = ({ objective }) => {
        if (objective.id === 'obj-fail-1') {
          return {
            thought: 'Assert missing header',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'MissingHeaderA_123' },
          };
        }
        if (objective.id === 'obj-fail-2') {
          return {
            thought: 'Assert missing footer',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'MissingFooterB_456' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Check header A and footer B',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
          stepTimeoutMs: 1000,
        }
      );

      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 2);
      const fail1 = report.steps.find((s) => s.objectiveId === 'obj-fail-1' && s.status === 'FAIL');
      const fail2 = report.steps.find((s) => s.objectiveId === 'obj-fail-2' && s.status === 'FAIL');
      assert.ok(fail1, 'Objective 1 failure must be preserved');
      assert.ok(fail2, 'Objective 2 failure must be preserved');
      assert.match(fail1.actual, /MissingHeaderA_123/i);
      assert.match(fail2.actual, /MissingFooterB_456/i);
    });

    it('4. accurately identifies unexecuted objectives as SKIPPED when a fatal infrastructure error occurs', async () => {
      const mockObjectives = [
        {
          id: 'obj-1',
          description: 'Initial objective during which browser terminates',
          targetBehavior: 'Fatal crash handling',
        },
        {
          id: 'obj-2',
          description: 'Unreached Objective A',
          targetBehavior: 'Post-crash objective',
        },
        {
          id: 'obj-3',
          description: 'Unreached Objective B',
          targetBehavior: 'Post-crash objective',
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Test fatal browser crash handling',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps: [],
          simulateFatalBrowserCrash: true,
        }
      );

      assert.equal(report.status, 'error');
      // obj-1 should be recorded as error
      const errorStep = report.steps.find((s) => s.objectiveId === 'obj-1');
      assert.ok(errorStep);
      assert.equal(errorStep.status, 'ERROR');

      // obj-2 and obj-3 must be explicitly marked as SKIPPED with fatal error notice
      const skipped2 = report.steps.find((s) => s.objectiveId === 'obj-2');
      const skipped3 = report.steps.find((s) => s.objectiveId === 'obj-3');
      assert.ok(skipped2);
      assert.ok(skipped3);
      assert.equal(skipped2.status, 'SKIPPED');
      assert.equal(skipped3.status, 'SKIPPED');
      assert.match(skipped2.actual, /fatal infrastructure error/i);
      assert.match(skipped3.actual, /fatal infrastructure error/i);

      // notTested must list the unexecuted objectives
      assert.match(report.coverageAndLimitations.notTested, /Unreached Objective A \(SKIPPED\)/i);
      assert.match(report.coverageAndLimitations.notTested, /Unreached Objective B \(SKIPPED\)/i);
    });

    it('5. maintains accurate overall status: partial when an objective is blocked and another passes', async () => {
      const mockObjectives = [
        {
          id: 'obj-blocked',
          description: 'Access protected route that is blocked',
          targetBehavior: 'Blocked barrier check',
        },
        {
          id: 'obj-pass',
          description: 'Check calendar date',
          targetBehavior: 'Date check',
        },
      ];

      const mockSteps = ({ objective, stepNumber }) => {
        if (objective.id === 'obj-blocked') {
          return {
            thought: 'Identify login barrier and conclude blocked',
            action: 'conclude',
            conclude: {
              outcome: 'BLOCKED',
              reasoning: 'Authentication prerequisite missing: test credentials required.',
            },
          };
        }
        if (objective.id === 'obj-pass') {
          if (stepNumber <= 2) {
            return {
              thought: 'Verify date synchronization',
              action: 'assertDateSync',
            };
          }
          return {
            thought: 'Conclude date verification',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Date verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Inspect protected route and check calendar date.',
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      // Status must be partial because one passed and one was blocked
      assert.equal(report.status, 'partial');
      assert.equal(report.blockedSteps, 1);
      assert.ok(report.passedSteps >= 1);
      assert.equal(report.failedSteps, 0);
    });
  });

  describe('4. Authentication Prerequisites, Login Verification & Session Restoration', () => {
    it('accurately classifies login-testing objectives and distinguishes them from authenticated objectives', () => {
      // Login verification objectives (must NOT require existing session)
      const objLoginValid = {
        id: 'obj-1',
        description: 'Test the login page with valid and invalid credentials',
        targetBehavior: 'Verify login functionality with valid and invalid credentials',
        preconditions: ['Login credentials', 'Login page accessible'],
      };
      assert.equal(isLoginVerificationObjective(objLoginValid), true);
      assert.equal(requiresValidCredentials(objLoginValid), true);
      assert.equal(requiresAuthenticatedSession(objLoginValid), false);

      const objLoginInvalidOnly = {
        id: 'obj-2',
        description: 'Verify login rejection with deliberately invalid credentials',
        targetBehavior: 'Attempt invalid login and verify error message',
        expectedOutcome: 'Observable error displayed and access denied',
      };
      assert.equal(isLoginVerificationObjective(objLoginInvalidOnly), true);
      assert.equal(requiresValidCredentials(objLoginInvalidOnly), false);
      assert.equal(requiresAuthenticatedSession(objLoginInvalidOnly), false);

      // Login page inspection objective (must NOT require credentials or existing session)
      const objLoginInspect = {
        id: 'obj-inspect-only',
        description: 'Inspect login page layout and verify presence of sign-in form controls',
        targetBehavior: 'Login page inspection',
        preconditions: ['Login page accessible'],
      };
      assert.equal(isLoginVerificationObjective(objLoginInspect), true);
      assert.equal(requiresValidCredentials(objLoginInspect), false);
      assert.equal(requiresAuthenticatedSession(objLoginInspect), false);

      // Authenticated non-login objectives (strictly require active session)
      const objProfile = {
        id: 'obj-3',
        description: 'Inspect private user account order history',
        targetBehavior: 'View authenticated orders',
        requiresAuth: true,
      };
      assert.equal(isLoginVerificationObjective(objProfile), false);
      assert.equal(requiresAuthenticatedSession(objProfile), true);

      // Independent public objectives (neither login nor requiring auth)
      const objSearch = {
        id: 'obj-4',
        description: 'Search for Paracetamol and add first result to cart',
        targetBehavior: 'Search and cart operations',
        preconditions: ['Catalog page'],
      };
      assert.equal(isLoginVerificationObjective(objSearch), false);
      assert.equal(requiresAuthenticatedSession(objSearch), false);
    });

    it('1. executes a login-verification objective without requiring an existing authenticated session', async () => {
      const mockObjectives = [
        {
          id: 'obj-login',
          description: 'Test login page with valid and invalid credentials',
          targetBehavior: 'Verify login functionality with valid and invalid credentials',
          preconditions: ['Login credentials'],
        },
      ];

      // Dependency check must allow running without existing authenticated session
      const checkResult = checkObjectiveDependencies(mockObjectives[0], {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: { username: 'validuser', password: 'validpass123' },
      });
      assert.equal(checkResult.canRun, true, 'Login verification objective must be executable without prior session');

      const mockSteps = [
        {
          thought: 'Fill username',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Username' },
          value: 'validuser',
        },
        {
          thought: 'Fill password',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'validpass123',
        },
        {
          thought: 'Click sign in',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Sign In' },
        },
        {
          thought: 'Conclude login test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Login successfully verified.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test login page with valid and invalid credentials',
          credentials: { username: 'validuser', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.skippedSteps, 0);
      assert.equal(report.passedSteps >= 1, true);
      const loginSteps = report.steps.filter((s) => s.objectiveId === 'obj-login');
      assert.ok(loginSteps.length > 0, 'Login objective steps must be executed');
      assert.ok(loginSteps.every((s) => s.status === 'PASS'), 'All login objective steps must have status PASS');
      assert.match(report.coverageAndLimitations.tested, /login/i);
    });

    it('2. marks only the affected login objective as BLOCKED when valid credentials are missing', async () => {
      const mockObjectives = [
        {
          id: 'obj-login-valid',
          description: 'Verify login functionality with valid and invalid credentials',
          targetBehavior: 'Test login with valid credentials',
        },
      ];

      // Missing credentials check directly
      const checkResult = checkObjectiveDependencies(mockObjectives[0], {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: {},
      });
      assert.equal(checkResult.canRun, false);
      assert.equal(checkResult.status, 'BLOCKED');
      assert.match(checkResult.reason, /Blocked: Testing valid login requires test credentials/i);
      assert.doesNotMatch(checkResult.reason, /Requires an authenticated session/i);

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test login page with valid credentials',
          credentials: {}, // missing credentials!
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps: [],
        }
      );

      assert.equal(report.status, 'blocked');
      assert.equal(report.blockedSteps, 1);
      assert.equal(report.skippedSteps, 0);
      const blockedStep = report.steps.find((s) => s.objectiveId === 'obj-login-valid');
      assert.ok(blockedStep);
      assert.equal(blockedStep.status, 'BLOCKED');
      assert.equal(blockedStep.action, 'blocked');
      assert.match(blockedStep.actual, /Blocked: Testing valid login requires test credentials/i);
    });

    it('3. executes invalid login testing with deliberately invalid credentials and verifies rejection', async () => {
      const mockObjectives = [
        {
          id: 'obj-invalid-login',
          description: 'Test invalid login rejection',
          targetBehavior: 'Attempt invalid login and verify error message',
          expectedOutcome: 'Error alert displayed and access denied',
        },
      ];

      // Invalid login does NOT require valid credentials
      const checkResult = checkObjectiveDependencies(mockObjectives[0], {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: {},
      });
      assert.equal(checkResult.canRun, true, 'Invalid login test does not require valid credentials');

      const mockSteps = [
        {
          thought: 'Fill invalid username',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Username' },
          value: 'deliberately_invalid_user',
        },
        {
          thought: 'Fill invalid password',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'wrong_password_test',
        },
        {
          thought: 'Submit invalid credentials',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Sign In' },
        },
        {
          thought: 'Assert error message is visible',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Invalid username or password' },
        },
        {
          thought: 'Conclude invalid login verified',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Access correctly denied with error message.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test invalid login rejection',
          credentials: {},
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      const assertErrStep = report.steps.find((s) => s.action === 'assertVisible');
      assert.ok(assertErrStep);
      assert.equal(assertErrStep.status, 'PASS');
      assert.match(assertErrStep.actual, /visible/i);
    });

    it('4. executes successful login followed by an authenticated objective and restores session', async () => {
      const mockObjectives = [
        {
          id: 'obj-1-login',
          description: 'Verify login functionality with valid and invalid credentials',
          targetBehavior: 'Test login with credentials',
        },
        {
          id: 'obj-2-orders',
          description: 'Inspect private member order history',
          targetBehavior: 'View authenticated order history',
          requiresAuth: true,
          dependsOn: ['obj-1-login'],
        },
      ];

      let obj1Call = 0;
      let obj2Call = 0;
      const mockSteps = ({ objective }) => {
        if (objective.id === 'obj-1-login') {
          obj1Call++;
          if (obj1Call === 1) {
            return {
              thought: 'Test invalid username',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Username' },
              value: 'wrong_user',
            };
          }
          if (obj1Call === 2) {
            return {
              thought: 'Test invalid password',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Password' },
              value: 'wrong_pass',
            };
          }
          if (obj1Call === 3) {
            return {
              thought: 'Click submit for invalid login',
              action: 'click',
              target: { strategy: 'role', value: 'button', name: 'Sign In' },
            };
          }
          if (obj1Call === 4) {
            return {
              thought: 'Assert error message',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'Invalid username or password' },
            };
          }
          // Now enter valid credentials
          if (obj1Call === 5) {
            return {
              thought: 'Enter valid username',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Username' },
              value: 'validuser',
            };
          }
          if (obj1Call === 6) {
            return {
              thought: 'Enter valid password',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Password' },
              value: 'validpass123',
            };
          }
          if (obj1Call === 7) {
            return {
              thought: 'Submit valid login',
              action: 'click',
              target: { strategy: 'role', value: 'button', name: 'Sign In' },
            };
          }
          if (obj1Call === 8) {
            return {
              thought: 'Assert dashboard is visible',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'Welcome, Member!' },
            };
          }
          return {
            thought: 'Conclude login test passed',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Valid and invalid authentication verified.' },
          };
        }

        if (objective.id === 'obj-2-orders') {
          obj2Call++;
          if (obj2Call === 1) {
            return {
              thought: 'Assert order history link in authenticated dashboard',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'My Order History' },
            };
          }
          return {
            thought: 'Conclude order history verified',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Order history is accessible in authenticated session.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test login page with valid and invalid credentials, then inspect order history.',
          credentials: { username: 'validuser', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      assert.ok(report.passedSteps >= 2);

      // Verify both objectives are marked PASS
      const obj1Steps = report.steps.filter((s) => s.objectiveId === 'obj-1-login');
      const obj2Steps = report.steps.filter((s) => s.objectiveId === 'obj-2-orders');
      assert.ok(obj1Steps.length > 0, 'Objective 1 steps must be present');
      assert.ok(obj2Steps.length > 0, 'Objective 2 steps must be present');
      assert.match(report.coverageAndLimitations.tested, /Verify login functionality/i);
      assert.match(report.coverageAndLimitations.tested, /Inspect private member order history/i);
    });

    it('5. continues independent public objectives even when login verification fails', async () => {
      const mockObjectives = [
        {
          id: 'obj-auth-fail',
          description: 'Verify login functionality with valid credentials',
          targetBehavior: 'Authentication check',
          isAuthGate: true,
        },
        {
          id: 'obj-dependent',
          description: 'Inspect private account orders',
          targetBehavior: 'Private orders check',
          requiresAuth: true,
          dependsOn: ['obj-auth-fail'],
        },
        {
          id: 'obj-independent-calendar',
          description: 'Check whether the displayed weekday matches the calendar date',
          targetBehavior: 'Calendar synchronization',
          requiresAuth: false,
        },
      ];

      const mockSteps = ({ objective, stepNumber }) => {
        if (objective.id === 'obj-auth-fail') {
          // Objective 1 fails: assert non-existent element
          return {
            thought: 'Assert non-existent login success banner to trigger failure',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'NonExistentBanner_999' },
          };
        }
        if (objective.id === 'obj-independent-calendar') {
          if (stepNumber <= 3) {
            return {
              thought: 'Verify date synchronization independently',
              action: 'assertDateSync',
            };
          }
          return {
            thought: 'Conclude calendar check',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Calendar verified independently.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Login, inspect orders, and check calendar date.',
          credentials: { username: 'validuser', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
          stepTimeoutMs: 1000,
        }
      );

      assert.equal(report.status, 'failed');
      assert.equal(report.failedSteps, 1);
      assert.equal(report.skippedSteps, 1);
      assert.ok(report.passedSteps >= 1);

      // obj-dependent must be SKIPPED
      const skippedStep = report.steps.find((s) => s.objectiveId === 'obj-dependent');
      assert.ok(skippedStep);
      assert.equal(skippedStep.status, 'SKIPPED');

      // obj-independent-calendar must PASS
      const calendarStep = report.steps.find((s) => s.objectiveId === 'obj-independent-calendar');
      assert.ok(calendarStep);
      assert.equal(calendarStep.status, 'PASS');
    });

    it('6. executes login-page inspection without credentials or an existing session', async () => {
      const mockObjectives = [
        {
          id: 'obj-inspect',
          description: 'Inspect login page layout and verify presence of sign-in form controls',
          targetBehavior: 'Login page inspection',
        },
      ];

      const mockSteps = [
        {
          thought: 'Verify username input field is visible',
          action: 'assertVisible',
          target: { strategy: 'placeholder', value: 'Username' },
        },
        {
          thought: 'Verify password input field is visible',
          action: 'assertVisible',
          target: { strategy: 'placeholder', value: 'Password' },
        },
        {
          thought: 'Verify submit button is visible',
          action: 'assertVisible',
          target: { strategy: 'role', value: 'button', name: 'Sign In' },
        },
        {
          thought: 'Conclude login page inspection',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'All login form controls observed.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Inspect the login page layout without credentials',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      assert.equal(report.blockedSteps, 0);
      assert.ok(report.passedSteps >= 3);
      assert.match(report.coverageAndLimitations.tested, /Inspect login page/i);
    });

    it('7. passing an invalid-login rejection test leaves session strictly unauthenticated', async () => {
      const mockObjectives = [
        {
          id: 'obj-invalid',
          description: 'Verify login rejection with deliberately invalid credentials',
          targetBehavior: 'Invalid login rejection',
        },
        {
          id: 'obj-private-orders',
          description: 'Inspect private account orders',
          targetBehavior: 'View private orders',
          requiresAuth: true,
          dependsOn: ['obj-invalid'],
        },
      ];

      let invalidObjSteps = 0;
      const mockSteps = ({ objective }) => {
        if (objective.id === 'obj-invalid') {
          invalidObjSteps++;
          if (invalidObjSteps === 1) {
            return {
              thought: 'Submit bad user',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Username' },
              value: 'wrong_user',
            };
          }
          if (invalidObjSteps === 2) {
            return {
              thought: 'Submit bad pass',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Password' },
              value: 'wrong_pass',
            };
          }
          if (invalidObjSteps === 3) {
            return {
              thought: 'Click submit',
              action: 'click',
              target: { strategy: 'role', value: 'button', name: 'Sign In' },
            };
          }
          if (invalidObjSteps === 4) {
            return {
              thought: 'Assert error message is visible',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'Invalid username or password' },
            };
          }
          return {
            thought: 'Conclude invalid login verified',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Rejection verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test invalid login rejection, then attempt private orders without credentials',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      // Objective 1 passed (invalid login rejection)
      const invalidStep = report.steps.find((s) => s.objectiveId === 'obj-invalid' && s.status === 'PASS');
      assert.ok(invalidStep);

      // Objective 2 must be SKIPPED because invalid login test did NOT establish authenticated session
      // and no valid credentials were provided to establish one
      const orderStep = report.steps.find((s) => s.objectiveId === 'obj-private-orders');
      assert.ok(orderStep, 'Private orders step must exist');
      assert.equal(orderStep.status, 'SKIPPED');
      assert.match(orderStep.actual, /Requires an authenticated session/i);
    });

    it('8. login objectives are never skipped merely because the active browser session is logged out', () => {
      const objLogin = {
        id: 'obj-login-flow',
        description: 'Verify login functionality with valid and invalid credentials',
        targetBehavior: 'Authentication verification',
        preconditions: ['Must be logged in', 'Login credentials'], // Misleading precondition should not block login test
      };

      // State is unauthenticated (logged out)
      const checkResult = checkObjectiveDependencies(objLogin, {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: { username: 'testuser', password: 'testpassword' },
      });

      assert.equal(checkResult.canRun, true, 'Login objective must be executable when currently logged out');
      assert.equal(checkResult.status, undefined);
    });

    it('9. continues independent public objectives when valid-login testing is blocked due to missing credentials', async () => {
      const mockObjectives = [
        {
          id: 'obj-valid-login',
          description: 'Login with valid credentials and verify user profile',
          targetBehavior: 'Authenticate with valid credentials',
        },
        {
          id: 'obj-independent-calendar',
          description: 'Check whether the displayed weekday matches the calendar date',
          targetBehavior: 'Calendar synchronization',
        },
      ];

      const mockSteps = ({ objective, stepNumber }) => {
        if (objective.id === 'obj-independent-calendar') {
          if (stepNumber <= 3) {
            return {
              thought: 'Verify date synchronization independently',
              action: 'assertDateSync',
            };
          }
          return {
            thought: 'Conclude calendar check',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Calendar verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Login with valid credentials, and verify calendar synchronization',
          credentials: {}, // Zero credentials provided -> Objective 1 BLOCKED
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      // Objective 1 must be BLOCKED
      const loginStep = report.steps.find((s) => s.objectiveId === 'obj-valid-login');
      assert.ok(loginStep, 'Valid login step must exist');
      assert.equal(loginStep.status, 'BLOCKED');

      // Objective 2 must be PASS
      const calendarStep = report.steps.find((s) => s.objectiveId === 'obj-independent-calendar');
      assert.ok(calendarStep, 'Independent calendar step must exist');
      assert.equal(calendarStep.status, 'PASS');

      // Overall status partial
      assert.equal(report.status, 'partial');
      assert.equal(report.blockedSteps, 1);
      assert.ok(report.passedSteps >= 1);
      assert.equal(report.skippedSteps, 0);
    });
  });

  describe('5. Credential Integrity & Exact Preservation', () => {
    it('1. preserves exact user-supplied email (abc@gmail.com) when AI model returns a truncated or hallucinated value (a@gmail.com)', async () => {
      const mockObjectives = [
        {
          id: 'obj-login-exact',
          description: 'Login with user credentials',
          targetBehavior: 'Authenticate with valid credentials',
        },
      ];

      const mockSteps = [
        {
          thought: 'Fill email field with user credential',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Username' },
          value: 'a@gmail.com', // Truncated/hallucinated value from AI model
        },
        {
          thought: 'Fill password field',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: '[VALID_PASSWORD]',
        },
        {
          thought: 'Submit login',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Sign In' },
        },
        {
          thought: 'Conclude login test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Login successfully verified.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Login to portal with test credentials',
          credentials: { username: 'abc@gmail.com', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      const emailStep = report.steps.find((s) => s.action === 'fill' && s.description.includes('email'));
      assert.ok(emailStep, 'Email fill step must exist');
      // Step actual MUST reflect exact user-supplied email, NOT the model-hallucinated 'a@gmail.com'
      assert.equal(emailStep.actual, 'Filled input with "abc@gmail.com"');
    });

    it('2. preserves exact user-supplied password and safely masks it as •••••••• in reports', async () => {
      const mockObjectives = [
        {
          id: 'obj-login-pass',
          description: 'Login with user credentials',
          targetBehavior: 'Authenticate with valid credentials',
        },
      ];

      const mockSteps = [
        {
          thought: 'Fill password field with user credential',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: '••••••••',
        },
        {
          thought: 'Conclude login test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Password filled.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Login with test credentials',
          credentials: { username: 'abc@gmail.com', password: 'SuperSecret123!@#' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      const passStep = report.steps.find((s) => s.action === 'fill' && s.description.includes('password'));
      assert.ok(passStep, 'Password fill step must exist');
      assert.equal(passStep.actual, 'Filled input with ••••••••');
      // Verify raw password never appears in any step description or actual output
      for (const step of report.steps) {
        assert.ok(!JSON.stringify(step).includes('SuperSecret123!@#'), 'Password must never appear in report steps');
      }
    });

    it('3. preserves deliberately invalid username and password during invalid-login testing', async () => {
      const mockObjectives = [
        {
          id: 'obj-invalid-cred',
          description: 'Verify login rejection with deliberately invalid credentials',
          targetBehavior: 'Invalid login rejection',
        },
      ];

      const mockSteps = [
        {
          thought: 'Fill deliberately invalid username to test rejection',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Username' },
          value: 'deliberately_invalid_user@example.com',
        },
        {
          thought: 'Fill deliberately invalid password to test rejection',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'wrong_password_999',
        },
        {
          thought: 'Click submit',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Sign In' },
        },
        {
          thought: 'Assert error message is visible',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Invalid username or password' },
        },
        {
          thought: 'Conclude invalid login test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Rejection verified.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test invalid login rejection',
          credentials: { username: 'abc@gmail.com', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      const userStep = report.steps.find((s) => s.action === 'fill' && s.description.includes('username'));
      assert.ok(userStep);
      // Deliberate invalid username must be preserved and filled, NOT replaced with 'abc@gmail.com'
      assert.equal(userStep.actual, 'Filled input with "deliberately_invalid_user@example.com"');

      const passStep = report.steps.find((s) => s.action === 'fill' && s.description.includes('password'));
      assert.ok(passStep);
      assert.equal(passStep.actual, 'Filled input with •••••••• (invalid test password)');
    });
  });

  describe('6. Autonomous Public Website Testing & Dynamic Access Discovery', () => {
    it('1. executes public search and cart objective without requiring login credentials', async () => {
      const mockObjectives = [
        {
          id: 'obj-public-cart',
          description: 'Search for Paracetamol, add the first result to the cart, and verify addition',
          targetBehavior: 'Search and cart operations on public store',
        },
      ];

      // Dependency check must allow running without credentials
      const checkResult = checkObjectiveDependencies(mockObjectives[0], {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: {},
      });
      assert.equal(checkResult.canRun, true, 'Public shopping objective must be runnable without credentials');

      const mockSteps = [
        {
          thought: 'Fill search query for Paracetamol',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Search for medicine...' },
          value: 'Paracetamol',
        },
        {
          thought: 'Click search button',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Search' },
        },
        {
          thought: 'Click Add to Cart',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Add to Cart' },
        },
        {
          thought: 'Assert item added to cart',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Added to Cart: Paracetamol 500mg' },
        },
        {
          thought: 'Conclude public shopping test',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Search and cart verified on public store.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/public-store`,
          instructions: 'Search for Paracetamol and add first result to cart',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.blockedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      assert.ok(report.passedSteps >= 4);
      assert.equal(report.missingCredentials.length, 1);
    });

    it('2. dynamically discovers that a feature redirects to an authentication barrier and marks it BLOCKED when credentials are unavailable', async () => {
      const mockObjectives = [
        {
          id: 'obj-checkout',
          description: 'Access shopping cart checkout and proceed',
          targetBehavior: 'Cart checkout verification',
        },
      ];

      // Initially objective is not assumed to be protected
      const checkResult = checkObjectiveDependencies(mockObjectives[0], {
        failedObjectiveIds: new Set(),
        authFailed: false,
        authSucceeded: false,
        credentials: {},
      });
      assert.equal(checkResult.canRun, true, 'Cart checkout is not assumed protected upfront');

      const mockSteps = [
        {
          thought: 'Click proceed to checkout',
          action: 'click',
          target: { strategy: 'text', value: 'Proceed to Checkout' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/store-with-protected-checkout`,
          instructions: 'Access shopping cart checkout and proceed',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'blocked');
      assert.equal(report.blockedSteps, 1);
      assert.equal(report.failedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      const blockedStep = report.steps.find((s) => s.status === 'BLOCKED');
      assert.ok(blockedStep, 'Step must be recorded as BLOCKED');
      assert.match(blockedStep.actual, /Authentication prerequisite required|Authentication barrier/i);
      assert.match(report.blockedReason, /Authentication prerequisite required|Authentication barrier/i);
    });

    it('3. continues independent public objectives when a protected feature is blocked due to missing credentials', async () => {
      const mockObjectives = [
        {
          id: 'obj-protected-checkout',
          description: 'Access shopping cart checkout and proceed',
          targetBehavior: 'Cart checkout verification',
        },
        {
          id: 'obj-independent-calendar',
          description: 'Check whether the displayed weekday matches the calendar date',
          targetBehavior: 'Calendar synchronization',
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/store-with-protected-checkout`,
          instructions: 'Test checkout and verify calendar synchronization',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps: [
            // Objective 1 clicks checkout and gets blocked upon encountering auth barrier
            {
              thought: 'Click checkout',
              action: 'click',
              target: { strategy: 'text', value: 'Proceed to Checkout' },
            },
            // Objective 2 starts; navigates to calendar and verifies date sync
            {
              thought: 'Navigate to calendar page',
              action: 'navigate',
              value: `${baseUrl}/calendar-sync`,
            },
            {
              thought: 'Verify date sync on calendar page',
              action: 'assertDateSync',
            },
            {
              thought: 'Conclude calendar check',
              action: 'conclude',
              conclude: { outcome: 'PASS', reasoning: 'Calendar verified.' },
            },
          ],
        }
      );

      // Overall status is partial because one was blocked and one passed
      assert.equal(report.status, 'partial');
      assert.equal(report.blockedSteps, 1);
      assert.ok(report.passedSteps >= 1);
      assert.equal(report.failedSteps, 0);

      const blockedStep = report.steps.find((s) => s.objectiveId === 'obj-protected-checkout' && s.status === 'BLOCKED');
      assert.ok(blockedStep, 'Protected checkout must be recorded as BLOCKED');

      const passStep = report.steps.find((s) => s.objectiveId === 'obj-independent-calendar' && s.status === 'PASS');
      assert.ok(passStep, 'Independent calendar check must execute and PASS');
    });

    it('4. dynamically restores authenticated session using supplied credentials when a protected feature barrier is discovered', async () => {
      const mockObjectives = [
        {
          id: 'obj-protected-orders',
          description: 'Access member order history',
          targetBehavior: 'Member orders verification',
        },
      ];

      const mockSteps = [
        {
          thought: 'Conclude order check',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Successfully accessed orders after session restoration.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/store-with-protected-orders`,
          instructions: 'Access member order history',
          credentials: { username: 'abc@gmail.com', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.blockedSteps, 0);
      assert.ok(report.passedSteps >= 1);
      // restoreSession step must be recorded in execution history
      const restoreStep = report.steps.find((s) => s.action === 'restoreSession');
      assert.ok(restoreStep, 'restoreSession step must have executed upon discovering barrier');
      assert.equal(restoreStep.status, 'PASS');
    });
  });

  describe('7. Authenticated Workflow Execution, Session Restoration & Expiration Handling', () => {
    it('1. restores valid session when an invalid-login test leaves browser unauthenticated and subsequent objective requires auth', async () => {
      const mockObjectives = [
        {
          id: 'obj-invalid-check',
          description: 'Verify login rejection with deliberately invalid credentials',
          targetBehavior: 'Invalid login verification',
        },
        {
          id: 'obj-private-orders',
          description: 'Inspect private member order history',
          targetBehavior: 'View authenticated order history',
          requiresAuth: true,
        },
      ];

      let obj1Calls = 0;
      let obj2Calls = 0;

      const mockSteps = ({ objective }) => {
        if (objective.id === 'obj-invalid-check') {
          obj1Calls++;
          if (obj1Calls === 1) {
            return {
              thought: 'Submit bad username',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Username' },
              value: 'deliberately_invalid_user',
            };
          }
          if (obj1Calls === 2) {
            return {
              thought: 'Submit bad password',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Password' },
              value: 'wrong_password',
            };
          }
          if (obj1Calls === 3) {
            return {
              thought: 'Submit form',
              action: 'click',
              target: { strategy: 'role', value: 'button', name: 'Sign In' },
            };
          }
          if (obj1Calls === 4) {
            return {
              thought: 'Assert error message is visible',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'Invalid username or password' },
            };
          }
          return {
            thought: 'Conclude invalid login verification',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Rejection verified.' },
          };
        }

        if (objective.id === 'obj-private-orders') {
          obj2Calls++;
          if (obj2Calls === 1) {
            return {
              thought: 'Verify orders link is visible in restored session',
              action: 'assertVisible',
              target: { strategy: 'text', value: 'My Order History' },
            };
          }
          return {
            thought: 'Conclude order inspection',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Order history verified in restored authenticated session.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/login-test-portal`,
          instructions: 'Test invalid login rejection, then inspect member order history with valid credentials',
          credentials: { username: 'validuser', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.equal(report.skippedSteps, 0);
      assert.ok(report.passedSteps >= 2);

      // Verify restoreSession step was executed prior to running objective 2
      const restoreStep = report.steps.find((s) => s.action === 'restoreSession');
      assert.ok(restoreStep, 'restoreSession step must have been executed for objective 2');
      assert.equal(restoreStep.status, 'PASS');
      assert.match(restoreStep.actual, /Successfully restored authenticated session/i);

      // Both objectives must be satisfied
      assert.match(report.coverageAndLimitations.tested, /Verify login rejection/i);
      assert.match(report.coverageAndLimitations.tested, /Inspect private member order history/i);
    });

    it('2. detects expired session and safely restores session when valid credentials are available', async () => {
      const mockObjectives = [
        {
          id: 'obj-statement',
          description: 'Access member monthly statement',
          targetBehavior: 'Member statement inspection',
        },
      ];

      const mockSteps = [
        // Step 1: Click view statement link which triggers session expiration
        {
          thought: 'Click view monthly statement',
          action: 'click',
          target: { strategy: 'text', value: 'View Monthly Statement' },
        },
        // Upon click, page shows session expiration banner.
        // Agent detects expired session barrier, calls restoreAuthenticatedSession with supplied credentials,
        // and session is restored!
        {
          thought: 'Assert statement content is visible after session restoration',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Monthly Statement: October 2026' },
        },
        {
          thought: 'Conclude statement verification',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Statement verified after restoring expired session.' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/session-expiration-portal`,
          instructions: 'Access member monthly statement',
          credentials: { username: 'validuser', password: 'validpass123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      assert.equal(report.failedSteps, 0);
      assert.equal(report.blockedSteps, 0);
      assert.ok(report.passedSteps >= 2);

      const restoreStep = report.steps.find((s) => s.action === 'restoreSession');
      assert.ok(restoreStep, 'restoreSession step must have restored expired session');
      assert.equal(restoreStep.status, 'PASS');
    });

    it('3. detects expired session and halts safely as BLOCKED when valid credentials are unavailable', async () => {
      const mockObjectives = [
        {
          id: 'obj-statement',
          description: 'Access member monthly statement',
          targetBehavior: 'Member statement inspection',
        },
      ];

      const mockSteps = [
        {
          thought: 'Click view monthly statement',
          action: 'click',
          target: { strategy: 'text', value: 'View Monthly Statement' },
        },
      ];

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/session-expiration-portal`,
          instructions: 'Access member monthly statement',
          credentials: {}, // Zero credentials provided
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'blocked');
      assert.equal(report.blockedSteps, 1);
      assert.equal(report.failedSteps, 0);

      const blockedStep = report.steps.find((s) => s.status === 'BLOCKED');
      assert.ok(blockedStep, 'Objective must be marked BLOCKED when session expires without credentials');
      assert.match(blockedStep.actual, /Active session expired|Authentication prerequisite required/i);
    });

    it('4. marks dependent objectives as SKIPPED when authentication fails and avoids repeated login attempts', async () => {
      const mockObjectives = [
        {
          id: 'obj-1-valid-login',
          description: 'Log in with valid credentials and verify user profile',
          targetBehavior: 'Authenticate with valid credentials',
        },
        {
          id: 'obj-2-private-profile',
          description: 'Inspect private user account profile',
          targetBehavior: 'Private profile inspection',
          requiresAuth: true,
          dependsOn: ['obj-1-valid-login'],
        },
        {
          id: 'obj-3-calendar',
          description: 'Check whether the displayed weekday matches the calendar date',
          targetBehavior: 'Calendar synchronization',
        },
      ];

      let loginAttempts = 0;
      let obj3Calls = 0;

      const mockSteps = ({ objective }) => {
        if (objective.id === 'obj-1-valid-login') {
          loginAttempts++;
          if (loginAttempts === 1) {
            return {
              thought: 'Navigate to login portal',
              action: 'navigate',
              value: `${baseUrl}/login-test-portal`,
            };
          }
          if (loginAttempts === 2) {
            return {
              thought: 'Enter username',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Username' },
              value: 'rejected_user',
            };
          }
          if (loginAttempts === 3) {
            return {
              thought: 'Enter password',
              action: 'fill',
              target: { strategy: 'placeholder', value: 'Password' },
              value: 'wrong_password_123',
            };
          }
          if (loginAttempts === 4) {
            return {
              thought: 'Submit form',
              action: 'click',
              target: { strategy: 'role', value: 'button', name: 'Sign In' },
            };
          }
          return {
            thought: 'Conclude login attempt',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Form submitted.' },
          };
        }

        if (objective.id === 'obj-3-calendar') {
          obj3Calls++;
          if (obj3Calls === 1) {
            return {
              thought: 'Verify calendar date sync independently',
              action: 'assertDateSync',
            };
          }
          return {
            thought: 'Conclude calendar check',
            action: 'conclude',
            conclude: { outcome: 'PASS', reasoning: 'Calendar verified.' },
          };
        }
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/calendar-sync`,
          instructions: 'Login, inspect profile, and check calendar',
          credentials: { username: 'rejected_user', password: 'wrong_password_123' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      // Objective 1 failed because verification rejected the invalid credentials
      assert.equal(report.status, 'failed');
      const obj1Steps = report.steps.filter((s) => s.objectiveId === 'obj-1-valid-login');
      assert.ok(obj1Steps.length > 0);

      // Objective 2 was dependent on obj-1, so it must be SKIPPED
      const obj2Steps = report.steps.filter((s) => s.objectiveId === 'obj-2-private-profile');
      assert.ok(obj2Steps.length > 0);
      assert.equal(obj2Steps[0].status, 'SKIPPED');
      assert.match(obj2Steps[0].actual, /earlier authentication verification failed|prerequisite objective/i);

      // Objective 3 was independent, so it executed and passed!
      const obj3Steps = report.steps.filter((s) => s.objectiveId === 'obj-3-calendar');
      assert.ok(obj3Steps.length > 0);
      assert.ok(obj3Steps.some((s) => s.status === 'PASS'));

      // Ensure no repeated login attempt was made for objective 2
      const restoreSteps = report.steps.filter((s) => s.action === 'restoreSession');
      assert.equal(restoreSteps.length, 0, 'No repeated session restoration attempt when authFailed is true');
    });

    it('5. never assumes form submission alone is authentication success without verifiable browser evidence', async () => {
      // Test verifyAuthenticationSuccess directly on an unauthenticated page where submit button was clicked
      // but no redirect, no token, and no profile indicators exist
      const mockPage = {
        url: () => 'http://example.com/login',
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        context: () => ({
          cookies: async () => [],
        }),
        evaluate: async () => ({
          observedError: null,
          validationMessage: null,
          isLoading: false,
          hasVisiblePasswordInput: true, // Login form remains displayed!
          hasAuthTokenInStorage: false,
          tokenKey: null,
          discoveredIndicators: [],
          cookiePresent: false,
        }),
      };

      const authEvidence = await verifyAuthenticationSuccess(mockPage, {
        submittedUsername: 'testuser@example.com',
        preLoginUrl: 'http://example.com/login',
      });

      assert.equal(authEvidence.pass, false, 'Form submission without state change must NOT pass verification');
      assert.equal(authEvidence.status, 'FAIL');
      assert.match(authEvidence.actual, /Login form remains displayed/i);
    });
  });

  describe('8. Live Login Execution, Asynchronous Settlement & In-Flight State Handling', () => {
    it('1. waits for asynchronous login response while button displays "Logging in..." and verifies successful session', async () => {
      const mockObjectives = [
        {
          id: 'obj-async-valid',
          description: 'Login with valid credentials on asynchronous portal',
          targetBehavior: 'Valid login and access dashboard',
          requiresAuth: true,
        },
      ];

      let stepCall = 0;
      const mockSteps = () => {
        stepCall++;
        if (stepCall === 1) {
          return {
            thought: 'Fill email field with user credentials',
            action: 'fill',
            target: { strategy: 'placeholder', value: 'Email' },
            value: 'a@gmail.com', // Model-truncated value, should be replaced with exact abc@gmail.com
          };
        }
        if (stepCall === 2) {
          return {
            thought: 'Fill password field',
            action: 'fill',
            target: { strategy: 'placeholder', value: 'Password' },
            value: '',
          };
        }
        if (stepCall === 3) {
          return {
            thought: 'Submit login form and await asynchronous completion',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Login' },
          };
        }
        if (stepCall === 4) {
          return {
            thought: 'Verify dashboard heading after authentication settlement',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'Welcome Back' },
          };
        }
        return {
          thought: 'Conclude login verification',
          action: 'conclude',
          conclude: {
            outcome: 'PASS',
            reasoning: 'Logged in successfully with active session token',
          },
        };
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/async-login-portal`,
          instructions: 'Log in with valid credentials and verify dashboard',
          credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed', `Report should pass, got ${report.status}`);
      const fillEmailStep = report.steps.find((s) => s.action === 'fill' && s.description.includes('email'));
      assert.ok(fillEmailStep);
      assert.match(fillEmailStep.actual, /abc@gmail\.com/, 'Step must report exact user-supplied email, not truncated model value');

      const clickStep = report.steps.find((s) => s.action === 'click');
      assert.ok(clickStep);
      assert.equal(clickStep.status, 'PASS');

      const assertStep = report.steps.find((s) => s.action === 'assertVisible');
      assert.ok(assertStep);
      assert.equal(assertStep.status, 'PASS');
    });

    it('2. waits for asynchronous login response and verifies rejection message without failing prematurely', async () => {
      const mockObjectives = [
        {
          id: 'obj-async-invalid',
          description: 'Verify rejection with invalid credentials on asynchronous portal',
          targetBehavior: 'Test invalid login',
        },
      ];

      let stepCall = 0;
      const mockSteps = () => {
        stepCall++;
        if (stepCall === 1) {
          return {
            thought: 'Fill invalid email to test rejection',
            action: 'fill',
            target: { strategy: 'placeholder', value: 'Email' },
            value: 'invalid_user@gmail.com',
          };
        }
        if (stepCall === 2) {
          return {
            thought: 'Fill invalid password',
            action: 'fill',
            target: { strategy: 'placeholder', value: 'Password' },
            value: 'wrong_password_999',
          };
        }
        if (stepCall === 3) {
          return {
            thought: 'Submit login form to trigger rejection',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Login' },
          };
        }
        if (stepCall === 4) {
          return {
            thought: 'Verify error message appeared after settlement',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'Invalid email or password' },
          };
        }
        return {
          thought: 'Conclude rejection verified',
          action: 'conclude',
          conclude: {
            outcome: 'PASS',
            reasoning: 'Rejection error message verified successfully',
          },
        };
      };

      const report = await executeAiAgent(
        {
          url: `${baseUrl}/async-login-portal`,
          instructions: 'Test invalid login rejection',
          credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
        },
        {
          allowLocalForTesting: true,
          allowMock: true,
          mockObjectives,
          mockSteps,
        }
      );

      assert.equal(report.status, 'passed');
      const assertStep = report.steps.find((s) => s.action === 'assertVisible');
      assert.ok(assertStep);
      assert.equal(assertStep.status, 'PASS');
    });

    it('3. returns clear timeout diagnostic when authentication hangs in a loading state', async () => {
      // Mock a page where submit button stays in "Logging in..." indefinitely
      let evaluateCount = 0;
      const mockHangingPage = {
        url: () => 'http://example.com/login',
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        context: () => ({
          cookies: async () => [],
        }),
        evaluate: async () => {
          evaluateCount++;
          return {
            observedError: null,
            validationMessage: null,
            isLoading: true, // Remains loading forever
            loadingText: 'Logging in...',
            hasVisiblePasswordInput: true,
            hasAuthTokenInStorage: false,
            tokenKey: null,
            discoveredIndicators: [],
            cookiePresent: false,
          };
        },
      };

      const authEvidence = await verifyAuthenticationSuccess(mockHangingPage, {
        submittedUsername: 'abc@gmail.com',
        preLoginUrl: 'http://example.com/login',
        timeout: 500, // Short timeout for unit test
      });

      assert.equal(authEvidence.pass, false);
      assert.equal(authEvidence.status, 'NEEDS_CLARIFICATION');
      assert.match(authEvidence.actual, /Authentication request timed out: Login form remained in a loading state \('Logging in\.\.\.'\)/i);
      assert.ok(evaluateCount > 0);
    });

    it('4. awaits settlement when an action targets a button currently disabled in a loading state', async () => {
      // Direct unit test of verifyAuthenticationSuccess polling
      let callNum = 0;
      const mockSettlingPage = {
        url: () => (callNum >= 3 ? 'http://example.com/dashboard' : 'http://example.com/login'),
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        context: () => ({
          cookies: async () => [],
        }),
        evaluate: async () => {
          callNum++;
          if (callNum < 3) {
            // First 2 calls: in-flight loading
            return {
              observedError: null,
              validationMessage: null,
              isLoading: true,
              loadingText: 'Logging in...',
              hasVisiblePasswordInput: true,
              hasAuthTokenInStorage: false,
              tokenKey: null,
              discoveredIndicators: [],
              cookiePresent: false,
            };
          }
          // 3rd call: settled into dashboard with token
          return {
            observedError: null,
            validationMessage: null,
            isLoading: false,
            loadingText: null,
            hasVisiblePasswordInput: false,
            hasAuthTokenInStorage: true,
            tokenKey: 'auth_token',
            discoveredIndicators: ['Logout/Sign-out control'],
            cookiePresent: true,
          };
        },
      };

      const result = await verifyAuthenticationSuccess(mockSettlingPage, {
        submittedUsername: 'abc@gmail.com',
        preLoginUrl: 'http://example.com/login',
        timeout: 2000,
      });

      assert.equal(result.pass, true);
      assert.equal(result.status, 'PASS');
      assert.match(result.actual, /Authentication confirmed/i);
    });
  });
});
