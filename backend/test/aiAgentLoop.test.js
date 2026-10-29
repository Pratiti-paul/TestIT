import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executeAiAgent } from '../src/services/aiAgentService.js';
import { verifyDateAndWeekdaySync, extractDateTokens } from '../src/services/verifiers/dateVerifier.js';
import { verifyCalculation, verifySorting } from '../src/services/verifiers/calculationVerifier.js';
import { validateAgentDecision, getMissingProviderReport } from '../src/services/aiProvider/index.js';

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
});
