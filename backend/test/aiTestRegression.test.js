import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runAiTest, inspectPageType, ensureLoginPage, assertInvalidLogin } from '../src/services/aiTestRunner.js';
import { generateDeterministicPlan } from '../src/services/aiPlannerService.js';

describe('AI Test Execution Accuracy & Regression Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>TestIT - Login</title></head>
            <body>
              <h2>TestIT Login</h2>
              <form id="login-form">
                <label for="email">Email</label>
                <input id="email" type="email" placeholder="Email" name="email" />
                <label for="password">Password</label>
                <input id="password" type="password" placeholder="Password" name="password" />
                <button type="submit" id="submit-btn">Log in</button>
              </form>
              <div id="error-msg" role="alert" style="display:none; color:red;">Invalid email or password</div>
              <div id="dashboard" style="display:none;">
                <h3>Dashboard</h3>
                <p>Welcome to your account!</p>
                <button id="logout-btn">Logout</button>
              </div>
              <script>
                document.getElementById('login-form').addEventListener('submit', (e) => {
                  e.preventDefault();
                  const email = document.getElementById('email').value;
                  const password = document.getElementById('password').value;
                  if (email === 'valid@example.com' && password === 'ValidPassword123!') {
                    document.getElementById('login-form').style.display = 'none';
                    document.getElementById('error-msg').style.display = 'none';
                    document.getElementById('dashboard').style.display = 'block';
                  } else {
                    document.getElementById('error-msg').style.display = 'block';
                  }
                });
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/signup-with-login-link') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Medico - Create Account</title></head>
            <body>
              <h2>Medico Signup</h2>
              <form id="signup-form">
                <input name="fullname" placeholder="Full Name" />
                <input name="email" placeholder="Email" type="email" />
                <input name="password" placeholder="Password" type="password" />
                <button type="submit">Sign Up</button>
              </form>
              <p>Already have an account? <a href="/login" id="goto-login">Login</a></p>
            </body>
          </html>
        `);
      } else if (url.pathname === '/broken-click') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Broken Action</title></head>
            <body>
              <h2>Broken Action Page</h2>
              <button id="ineffective-button">Click to Navigate</button>
              <!-- Notice: button does nothing, no navigation or state change occurs -->
            </body>
          </html>
        `);
      } else if (url.pathname === '/silent-login-failure') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Silent Failure Login</title></head>
            <body>
              <h2>Silent Login</h2>
              <form id="silent-form">
                <input id="email" type="email" placeholder="Email" />
                <input id="password" type="password" placeholder="Password" />
                <button type="submit">Log in</button>
              </form>
              <!-- Notice: Form submits but never displays any error message -->
              <script>
                document.getElementById('silent-form').addEventListener('submit', (e) => {
                  e.preventDefault();
                  // Stays on page with no error message
                });
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/hanging-timeout') {
        // Delay response to guarantee client step timeout (300ms) without hanging indefinitely
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200);
            res.end('delayed');
          }
        }, 2000);
      } else if (url.pathname === '/signup-dead-end') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Registration Only</title></head>
            <body>
              <h2>Create Your Account</h2>
              <form>
                <input name="name" placeholder="Name" />
                <input name="email" placeholder="Email" />
                <input name="password" placeholder="Password" />
                <button type="submit">Register Now</button>
              </form>
              <!-- No login link exists anywhere on this page -->
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. verifies working login form succeeds with valid credentials', async () => {
    const plan = {
      objective: 'Verify working login form',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          description: 'Navigate to login page',
          expected: 'Landed on login page',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'valid@example.com',
          description: 'Fill valid email',
          expected: 'Email field filled',
          timeoutMs: 3000,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'ValidPassword123!',
          isSensitive: true,
          description: 'Fill valid password',
          expected: 'Password field filled',
          timeoutMs: 3000,
        },
        {
          id: 'step-4',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          description: 'Click login button',
          expected: 'Login submitted',
          timeoutMs: 3000,
        },
        {
          id: 'step-5',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Welcome to your account!' },
          description: 'Verify dashboard is visible',
          expected: 'Dashboard welcome message is visible',
          timeoutMs: 3000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.passedSteps, 5);
    assert.equal(report.failedSteps, 0);
    assert.equal(report.totalSteps, 5);
    assert.equal(report.executedSteps, 5);
    report.steps.forEach((s) => assert.equal(s.status, 'PASS'));
  });

  it('2. signup page with login link: discovers login link, navigates to login, and avoids filling signup', async () => {
    // Start URL is the signup page
    const startUrl = `${baseUrl}/signup-with-login-link`;

    const plan = {
      objective: 'Test login starting from signup page',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: startUrl,
          description: 'Navigate to site starting URL',
          expected: 'Landed on site',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'ensureLoginPage',
          description: 'Identify login controls or follow login link',
          expected: 'Current page confirmed as Login page with email and password inputs',
          timeoutMs: 4000,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'invalid@example.com',
          description: 'Fill email into login form',
          expected: 'Login email field filled',
          timeoutMs: 3000,
        },
      ],
    };

    const report = await runAiTest(plan, startUrl, { allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.passedSteps, 3);
    assert.equal(report.failedSteps, 0);

    // Verify step 2 navigated to /login
    const step2 = report.steps[1];
    assert.equal(step2.status, 'PASS');
    assert.match(step2.actual, /Discovered login navigation link/i);
    assert.match(report.finalUrl, /\/login$/);
  });

  it('3. valid and invalid authentication outcomes reported accurately', async () => {
    // Test invalid authentication rejection
    const invalidPlan = {
      objective: 'Test invalid login credentials rejection',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          description: 'Navigate to login',
          expected: 'Landed on login',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'wrong@example.com',
          description: 'Fill invalid email',
          expected: 'Email filled',
          timeoutMs: 3000,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'WrongPassword!',
          description: 'Fill invalid password',
          expected: 'Password filled',
          timeoutMs: 3000,
        },
        {
          id: 'step-4',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          description: 'Submit invalid credentials',
          expected: 'Credentials submitted',
          timeoutMs: 3000,
        },
        {
          id: 'step-5',
          action: 'assertInvalidLogin',
          description: 'Verify login error message is displayed',
          expected: 'Observable authentication error displayed or user remains unauthenticated on login page',
          timeoutMs: 3000,
        },
      ],
    };

    const report = await runAiTest(invalidPlan, `${baseUrl}/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.steps[4].status, 'PASS');
    assert.match(report.steps[4].actual, /Invalid email or password/i);
  });

  it('4. a click that completes without error but fails to produce expected effect is marked as FAIL', async () => {
    const plan = {
      objective: 'Verify click with unfulfilled effect expectation',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/broken-click`,
          description: 'Navigate to broken click page',
          expected: 'Landed on page',
          timeoutMs: 3000,
        },
        {
          id: 'step-2',
          action: 'click',
          target: { strategy: 'css', value: '#ineffective-button' },
          verifyEffect: 'urlChange', // Expects URL to change after clicking
          description: 'Click button expecting URL transition',
          expected: 'URL changes after click',
          timeoutMs: 3000,
        },
        {
          id: 'step-3',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Post-Click Success' },
          description: 'Subsequent step that depends on click navigation',
          expected: 'Post-click element is visible',
          timeoutMs: 3000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/broken-click`, { allowLocalForTesting: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.steps[0].status, 'PASS');
    assert.equal(report.steps[1].status, 'FAIL');
    assert.match(report.steps[1].actual, /expected functional effect did not occur/i);
    // Verifies step 3 was skipped
    assert.equal(report.steps[2].status, 'SKIPPED');
  });

  it('5. missing error message after invalid login is caught when explicit error is required', async () => {
    const plan = {
      objective: 'Test invalid login on silently failing form',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/silent-login-failure`,
          description: 'Navigate to silent login',
          expected: 'Landed on page',
          timeoutMs: 3000,
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'bad@example.com',
          description: 'Enter bad email',
          expected: 'Bad email entered',
          timeoutMs: 3000,
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          description: 'Submit credentials',
          expected: 'Form submitted',
          timeoutMs: 3000,
        },
        {
          id: 'step-4',
          action: 'assertInvalidLogin',
          requireErrorMessage: true, // Requires an explicit error message element
          description: 'Verify error message element is rendered',
          expected: 'Observable authentication error message is displayed',
          timeoutMs: 2000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/silent-login-failure`, { allowLocalForTesting: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.steps[3].status, 'FAIL');
    assert.match(report.steps[3].actual, /error message was not displayed/i);
  });

  it('6. incorrect page navigation halts with BLOCKED when stuck on signup with no login link', async () => {
    const plan = {
      objective: 'Attempt login on a registration-only dead end page',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/signup-dead-end`,
          description: 'Navigate to dead-end signup page',
          expected: 'Landed on page',
          timeoutMs: 3000,
        },
        {
          id: 'step-2',
          action: 'ensureLoginPage',
          description: 'Locate login page controls or navigation link',
          expected: 'Login page located',
          timeoutMs: 3000,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'test@example.com',
          description: 'Fill login email',
          expected: 'Email filled',
          timeoutMs: 3000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/signup-dead-end`, { allowLocalForTesting: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.steps[1].status, 'BLOCKED');
    assert.match(report.steps[1].actual, /registration\/signup page/i);
    assert.match(report.steps[1].actual, /no login navigation link/i);
    assert.equal(report.steps[2].status, 'SKIPPED');
  });

  it('7. blocked prerequisite step marks step as BLOCKED and aborts execution safely', async () => {
    const plan = {
      objective: 'Test missing interactive element',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          description: 'Navigate to login',
          expected: 'Landed on login',
          timeoutMs: 3000,
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'css', value: '#non-existent-required-input' },
          value: 'some value',
          description: 'Fill non-existent input',
          expected: 'Input filled',
          timeoutMs: 1200,
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          description: 'Click button after filling input',
          expected: 'Button clicked',
          timeoutMs: 2000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.steps[1].status, 'BLOCKED');
    assert.match(report.steps[1].actual, /Unable to locate accessible control/i);
    assert.equal(report.steps[2].status, 'SKIPPED');
  });

  it('8. handles technical timeouts with ERROR status', async () => {
    const plan = {
      objective: 'Test technical timeout handling',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          description: 'Navigate to login page',
          expected: 'Landed on page',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'navigate',
          url: `${baseUrl}/hanging-timeout`,
          description: 'Navigate to hanging URL that exceeds timeout',
          expected: 'Navigation should time out',
          timeoutMs: 300,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'test@example.com',
          description: 'Fill email',
          expected: 'Email filled',
          timeoutMs: 2000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.steps[1].status, 'ERROR');
    assert.match(report.steps[1].actual, /Timeout/i);
    assert.equal(report.steps[2].status, 'SKIPPED');
  });

  it('9. verifies that a failed step marks all subsequent dependent steps as SKIPPED with clear reasons', async () => {
    const plan = {
      objective: 'Verify skip semantics across multi-step flow',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          description: 'Step 1: Navigate to login',
          expected: 'Navigation passes',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Definitely Non-Existent Element' },
          description: 'Step 2: Assertion that will fail',
          expected: 'Non-existent element is visible',
          timeoutMs: 1200,
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'user@example.com',
          description: 'Step 3: Dependent fill action',
          expected: 'Email input accepts text',
          timeoutMs: 2000,
        },
        {
          id: 'step-4',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          description: 'Step 4: Dependent click action',
          expected: 'Log in button is clicked',
          timeoutMs: 2000,
        },
        {
          id: 'step-5',
          action: 'screenshot',
          description: 'Step 5: Dependent snapshot evidence',
          expected: 'Evidence capture',
          timeoutMs: 2000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.totalSteps, 5);
    assert.equal(report.executedSteps, 2);
    assert.equal(report.passedSteps, 1);
    assert.equal(report.failedSteps, 1);
    assert.equal(report.skippedSteps, 3);

    // Step 1: PASS
    assert.equal(report.steps[0].status, 'PASS');

    // Step 2: FAIL
    assert.equal(report.steps[1].status, 'FAIL');
    assert.match(report.steps[1].actual, /Failed:/i);

    // Steps 3, 4, 5: SKIPPED
    for (let i = 2; i <= 4; i++) {
      assert.equal(report.steps[i].status, 'SKIPPED');
      assert.equal(report.steps[i].durationMs, 0);
      assert.match(report.steps[i].actual, /Skipped: Prerequisite Step 2 \(assertVisible\) did not succeed/i);
    }
  });
});
