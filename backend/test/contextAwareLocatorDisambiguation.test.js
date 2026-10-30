import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executeAiAgent } from '../src/services/aiAgentService.js';
import { MockProvider } from '../src/services/aiProvider/mockProvider.js';

describe('Phase 4.8B: Context-Aware Locator Disambiguation Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // ----------------------------------------------------------------------
      // FIXTURE 1: Heading and Submit Button with identical text ("Login")
      // ----------------------------------------------------------------------
      if (url.pathname === '/heading-and-submit') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Account Sign-In</title></head>
            <body>
              <header>
                <h2>Login</h2>
              </header>
              <main>
                <form id="login-form" onsubmit="event.preventDefault(); document.getElementById('login-success').style.display='block';">
                  <input type="text" name="user" placeholder="Username" />
                  <input type="password" name="pass" placeholder="Password" />
                  <button type="submit" id="submit-login-btn">Login</button>
                </form>
                <div id="login-success" style="display:none;" role="status">Login Successful!</div>
              </main>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 2: Link and Heading with identical text ("Documentation")
      // ----------------------------------------------------------------------
      if (url.pathname === '/link-and-heading') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Developer Portal</title></head>
            <body>
              <nav>
                <a href="/docs-page" id="nav-docs-link">Documentation</a>
              </nav>
              <main>
                <h1>Documentation</h1>
                <p>Welcome to our API reference documentation.</p>
              </main>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 3: Multiple buttons with identical labels in different containers
      // ----------------------------------------------------------------------
      if (url.pathname === '/buttons-in-containers') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Cloud Subscriptions</title></head>
            <body>
              <h1>Choose Your Plan</h1>
              <div class="pricing-grid">
                <section class="plan-card" id="basic-plan">
                  <h3>Developer Basic</h3>
                  <p>$15/mo for individual builders</p>
                  <button class="plan-btn" onclick="document.getElementById('plan-chosen').innerText='Developer Basic Selected';">Select Plan</button>
                </section>
                <section class="plan-card" id="business-plan">
                  <h3>Business Scale</h3>
                  <p>$150/mo with custom SLAs and high throughput</p>
                  <button class="plan-btn" onclick="document.getElementById('plan-chosen').innerText='Business Scale Selected';">Select Plan</button>
                </section>
              </div>
              <div id="plan-chosen" role="status"></div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 4: Button and Link with similar accessible names ("Contact Support")
      // ----------------------------------------------------------------------
      if (url.pathname === '/button-and-link') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Customer Service</title></head>
            <body>
              <header>
                <a href="/support-faq" id="faq-link">Contact Support</a>
              </header>
              <main>
                <form id="ticket-form" onsubmit="event.preventDefault(); document.getElementById('msg-sent').style.display='block';">
                  <textarea placeholder="Describe your issue"></textarea>
                  <button type="submit" id="ticket-btn">Contact Support</button>
                </form>
                <div id="msg-sent" style="display:none;" role="status">Support Request Submitted!</div>
              </main>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 5: Icon-only interactive control
      // ----------------------------------------------------------------------
      if (url.pathname === '/icon-control') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Search Dashboard</title></head>
            <body>
              <header>
                <span>Search</span>
                <button id="search-icon-btn" aria-label="Search" title="Search" onclick="document.getElementById('search-dialog').style.display='block';">
                  <svg width="16" height="16"><circle cx="8" cy="8" r="6" /></svg>
                </button>
              </header>
              <div id="search-dialog" style="display:none;" role="dialog">Search Filter Dialog Opened</div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 6: Genuine unresolved ambiguity (two identical buttons in identical context)
      // ----------------------------------------------------------------------
      if (url.pathname === '/genuine-ambiguity') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Unresolvable Controls</title></head>
            <body>
              <h1>System Actions</h1>
              <div class="box">
                <button class="purge-btn">Purge Cache</button>
              </div>
              <div class="box">
                <button class="purge-btn">Purge Cache</button>
              </div>
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
  // Test 1: Heading and Submit Button with identical text ("Login")
  // ==========================================================================
  it('1. correctly distinguishes an interactive submit button from a static heading with identical text "Login"', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Login submit button to authenticate the form',
        action: 'click',
        // Model used generic strategy: 'text' which matches both <h2>Login</h2> and <button>Login</button>
        target: { strategy: 'text', value: 'Login' },
        expectedOutcome: 'Form submitted and login verified',
      },
      {
        thought: 'Login success message is visible, conclude PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Successfully clicked the Login submit button and verified success banner.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/heading-and-submit`,
        instructions: 'Submit the login form by clicking Login and verify success',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass by selecting the submit button, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep, 'Click step should exist');
    assert.strictEqual(clickStep.status, 'PASS', 'Click step should pass');
  });

  // ==========================================================================
  // Test 2: Link and Heading with identical text ("Documentation")
  // ==========================================================================
  it('2. prioritizes a navigational link over a non-interactive heading when action intent is navigation', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Navigate to the Documentation section using the navigation link',
        action: 'click',
        target: { strategy: 'text', value: 'Documentation' },
        expectedOutcome: 'Documentation link followed',
      },
      {
        thought: 'Link clicked successfully',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Successfully navigated via the Documentation link.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/link-and-heading`,
        instructions: 'Navigate to the Documentation page via the nav link',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass by selecting the link, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep);
    assert.strictEqual(clickStep.status, 'PASS');
  });

  // ==========================================================================
  // Test 3: Multiple buttons with identical labels in different containers
  // ==========================================================================
  it('3. uses container context to disambiguate identical "Select Plan" buttons across pricing cards', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Select Plan button specifically inside the Business Scale card',
        action: 'click',
        target: { strategy: 'text', value: 'Select Plan' },
        expectedOutcome: 'Business Scale plan selected',
      },
      {
        thought: 'Verify that Business Scale is selected',
        action: 'assertText',
        target: { strategy: 'css', value: '#plan-chosen' },
        value: 'Business Scale Selected',
        expectedOutcome: 'Business Scale Selected text is present',
      },
      {
        thought: 'Plan selected and verified, conclude PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Business Scale plan correctly disambiguated and chosen.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/buttons-in-containers`,
        instructions: 'Select the Business Scale plan and verify selection',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass, got: ${report.status}`);
    const assertStep = report.steps.find((s) => s.action === 'assertText');
    assert.ok(assertStep);
    assert.strictEqual(assertStep.status, 'PASS');
  });

  // ==========================================================================
  // Test 4: Button and Link with similar accessible names ("Contact Support")
  // ==========================================================================
  it('4. distinguishes between a form submit button and a header link with identical accessible name based on submit intent', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Submit the support ticket form by clicking Contact Support',
        action: 'click',
        target: { strategy: 'text', value: 'Contact Support' },
        expectedOutcome: 'Support ticket submitted',
      },
      {
        thought: 'Verify message sent confirmation is visible',
        action: 'assertVisible',
        target: { strategy: 'css', value: '#msg-sent' },
        expectedOutcome: 'Confirmation banner is visible',
      },
      {
        thought: 'Conclude PASS after verifying form submission',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Form submit button was selected and ticket submitted successfully.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/button-and-link`,
        instructions: 'Submit the ticket form using Contact Support and verify submission confirmation',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass by selecting form button, got: ${report.status}`);
    const assertStep = report.steps.find((s) => s.action === 'assertVisible');
    assert.ok(assertStep);
    assert.strictEqual(assertStep.status, 'PASS');
  });

  // ==========================================================================
  // Test 5: Icon-only interactive control vs static label
  // ==========================================================================
  it('5. identifies icon-only interactive button with aria-label/title and prioritizes over static text', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Search icon button to open search filters dialog',
        action: 'click',
        target: { strategy: 'text', value: 'Search' },
        expectedOutcome: 'Search dialog opened',
      },
      {
        thought: 'Dialog is opened, conclude PASS',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Search icon button clicked and dialog opened.',
        },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/icon-control`,
        instructions: 'Click the Search button to open the search filters dialog',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass with icon button, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep);
    assert.strictEqual(clickStep.status, 'PASS');
  });

  // ==========================================================================
  // Test 6: Genuine Unresolved Ambiguity (refuses arbitrary selection)
  // ==========================================================================
  it('6. safely halts as blocked when two genuinely equivalent interactive controls cannot be disambiguated', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Purge Cache button',
        action: 'click',
        target: { strategy: 'text', value: 'Purge Cache' },
        expectedOutcome: 'Cache purged',
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/genuine-ambiguity`,
        instructions: 'Click Purge Cache button',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'blocked', `Expected status "blocked" for unresolvable ambiguity, got: ${report.status}`);
    assert.match(
      report.blockedReason || report.failure?.description || '',
      /ambiguous/i,
      'Should report ambiguous controls'
    );
  });
});

