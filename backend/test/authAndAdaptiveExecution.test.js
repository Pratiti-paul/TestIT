import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runAiTest } from '../src/services/aiTestRunner.js';
import { verifyAuthenticationSuccess } from '../src/services/verifiers/authVerifier.js';

describe('Authentication Verification & Adaptive Execution Regression Suite', () => {
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
            <head><title>App Login</title></head>
            <body>
              <h2>Sign In</h2>
              <form id="login-form">
                <input id="email" type="email" placeholder="Email" />
                <input id="password" type="password" placeholder="Password" />
                <button type="submit" id="submit-btn">Log in</button>
              </form>
              <div id="error" role="alert" style="display:none; color:red;">Invalid credentials provided</div>
              <script>
                document.getElementById('login-form').addEventListener('submit', (e) => {
                  e.preventDefault();
                  const email = document.getElementById('email').value;
                  const pw = document.getElementById('password').value;
                  if (email === 'user@example.com' && pw === 'CorrectPass123!') {
                    localStorage.setItem('token', 'fake-jwt-token-xyz');
                    localStorage.setItem('user', JSON.stringify({ email }));
                    window.location.href = '/home';
                  } else {
                    document.getElementById('error').style.display = 'block';
                  }
                });
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/home') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>App Home</title></head>
            <body>
              <nav>
                <span class="user-avatar" aria-label="User Profile">U</span>
                <a href="/medicines">Medicines</a>
              </nav>
              <h1>Welcome to the Pharmacy</h1>
            </body>
          </html>
        `);
      } else if (url.pathname === '/medicines') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Medicine Listing</title></head>
            <body>
              <h2>All Medicines</h2>
              <input type="text" placeholder="Search for medicine..." id="search" />
              <button id="search-btn">Search</button>
              <div id="results">
                <div class="med-card">
                  <h3>Paracetamol 500mg</h3>
                  <button class="add-btn">Add to Cart</button>
                </div>
              </div>
            </body>
          </html>
        `);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Main Site</title></head>
            <body>
              <nav>
                <a href="/login">Login</a>
                <a href="/medicines">Medicines</a>
              </nav>
              <h1>Pharmacy Homepage</h1>
            </body>
          </html>
        `);
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. verifies successful authentication using multi-signal evidence without fixed labels', async () => {
    const plan = {
      objective: 'Test user login with valid credentials',
      planner: 'adaptive-engine',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          expected: 'Navigate to login',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'user@example.com',
          expected: 'Enter email',
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'CorrectPass123!',
          isSensitive: true,
          expected: 'Enter password',
        },
        {
          id: 'step-4',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          expected: 'Click Log in',
        },
        {
          id: 'step-5',
          action: 'assertAuthenticatedState',
          submittedUsername: 'user@example.com',
          expected: 'Verify authenticated session established',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login`, { stepTimeoutMs: 6000, allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 5);
    assert.equal(report.passedSteps, 5);
    assert.equal(report.failedSteps, 0);

    const authStep = report.steps.find((s) => s.action === 'assertAuthenticatedState');
    assert.equal(authStep.status, 'PASS');
    assert.match(authStep.actual, /confirmed|established/i);
  });

  it('2. continues independent steps when an authentication step fails (dependency-aware execution)', async () => {
    const plan = {
      objective: 'Attempt invalid login, then navigate to search independently',
      planner: 'adaptive-engine',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/login`,
          flowId: 'auth',
          expected: 'Navigate to login',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'wrong@example.com',
          flowId: 'auth',
          expected: 'Enter wrong email',
        },
        {
          id: 'step-3',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'WrongPass!',
          flowId: 'auth',
          isSensitive: true,
          expected: 'Enter wrong password',
        },
        {
          id: 'step-4',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          flowId: 'auth',
          expected: 'Click Log in',
        },
        {
          id: 'step-5',
          action: 'assertAuthenticatedState',
          isAuthGate: true,
          flowId: 'auth',
          submittedUsername: 'wrong@example.com',
          expected: 'Expect auth gate',
        },
        // Dependent auth step that should be skipped
        {
          id: 'step-6',
          action: 'assertVisible',
          requiresAuth: true,
          flowId: 'auth',
          target: { strategy: 'text', value: 'Secret Account Data' },
          expected: 'View secret account data',
        },
        // Independent public search step that SHOULD execute and pass!
        {
          id: 'step-7',
          action: 'ensureSearchPage',
          requiresAuth: false,
          flowId: 'search',
          startUrl: baseUrl,
          target: { strategy: 'placeholder', value: 'Search for medicine...' },
          fallbacks: [
            { strategy: 'role', value: 'link', name: 'Medicines' },
            { strategy: 'css', value: 'a[href*="medicines"]' },
          ],
          expected: 'Navigate to medicine catalog and find search',
        },
        {
          id: 'step-8',
          action: 'assertVisible',
          requiresAuth: false,
          flowId: 'search',
          target: { strategy: 'text', value: 'Paracetamol' },
          expected: 'Verify Paracetamol is listed',
        },
      ],
    };

    const report = await runAiTest(plan, baseUrl, { stepTimeoutMs: 6000, allowLocalForTesting: true });
    // Step 5 fails auth gate
    // Step 6 (requiresAuth: true) is skipped
    // Step 7 & 8 (independent search) continue and pass!
    assert.equal(report.status, 'failed'); // because step 5 failed
    const step5 = report.steps.find((s) => s.id === 'step-5');
    assert.equal(step5.status, 'FAIL');

    const step6 = report.steps.find((s) => s.id === 'step-6');
    assert.equal(step6.status, 'SKIPPED');
    assert.match(step6.actual, /Dependent on unfulfilled Step/i);

    const step7 = report.steps.find((s) => s.id === 'step-7');
    assert.equal(step7.status, 'PASS');

    const step8 = report.steps.find((s) => s.id === 'step-8');
    assert.equal(step8.status, 'PASS');

    assert.equal(report.passedSteps, 6);
    assert.equal(report.failedSteps, 1);
    assert.equal(report.skippedSteps, 1);
    assert.equal(report.totalSteps, 8);
    assert.equal(report.executedSteps, 7);
  });
});
