import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runAiTest } from '../src/services/aiTestRunner.js';
import { discoverWebsite } from '../src/services/websiteDiscoveryService.js';
import { verifyAuthenticationSuccess } from '../src/services/verifiers/authVerifier.js';

describe('End-to-End Website Discovery, Authentication & Adaptive Execution', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // Route 1: Multi-page site - Homepage has NO search field, only a link to /store/catalog
      if (url.pathname === '/multipage-home') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Generic Store Home</title></head>
            <body>
              <header>
                <nav>
                  <a href="/store/catalog">Products Catalog</a>
                  <a href="/login-redirect">Member Sign In</a>
                </nav>
              </header>
              <main>
                <h1>Welcome to Generic Store</h1>
                <p>Browse our extensive selection of healthcare products.</p>
              </main>
            </body>
          </html>
        `);
      }

      // Route 2: Separate catalog page containing search field
      else if (url.pathname === '/store/catalog') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Store Catalog & Search</title></head>
            <body>
              <h2>Find Products</h2>
              <input type="search" id="catalog-search" placeholder="Search catalog..." />
              <button id="search-btn">Search</button>
              <div id="catalog-results">
                <div class="product-item">
                  <h3>Amoxicillin 250mg</h3>
                  <button class="add-to-cart">Add to Cart</button>
                </div>
              </div>
            </body>
          </html>
        `);
      }

      // Route 3: Login that redirects to a dashboard on success
      else if (url.pathname === '/login-redirect') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Account Sign In</title></head>
            <body>
              <h2>Sign In</h2>
              <form id="login-form">
                <input id="user-email" type="email" placeholder="Email" />
                <input id="user-pass" type="password" placeholder="Password" />
                <button type="submit" id="login-btn">Log in</button>
              </form>
              <div id="error-banner" role="alert" style="display:none; color:red;">Invalid email or password</div>
              <script>
                document.getElementById('login-form').addEventListener('submit', (e) => {
                  e.preventDefault();
                  const em = document.getElementById('user-email').value;
                  const pw = document.getElementById('user-pass').value;
                  if (em === 'alex@example.com' && pw === 'ValidSecret123!') {
                    window.location.href = '/user/dashboard';
                  } else {
                    document.getElementById('error-banner').style.display = 'block';
                  }
                });
              </script>
            </body>
          </html>
        `);
      }

      // Route 4: Dashboard after login redirect
      else if (url.pathname === '/user/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>User Dashboard</title></head>
            <body>
              <nav>
                <span class="user-profile">Alex Smith</span>
                <a href="/logout">Logout</a>
              </nav>
              <h1>Welcome to your Dashboard, Alex!</h1>
              <div id="account-records">Personal Health Records</div>
            </body>
          </html>
        `);
      }

      // Route 5: In-page SPA login that succeeds without changing the URL
      else if (url.pathname === '/spa-login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>SPA App Home</title></head>
            <body>
              <div id="auth-container">
                <form id="spa-form">
                  <input type="email" placeholder="Email Address" id="spa-email" />
                  <input type="password" placeholder="Password" id="spa-pass" />
                  <button type="submit" id="spa-submit">Sign in</button>
                </form>
              </div>
              <div id="authenticated-area" style="display:none;">
                <nav id="user-nav">
                  <span class="profile-avatar" aria-label="User Avatar">Profile</span>
                  <a href="/spa-login">Refresh</a>
                </nav>
                <h3>Welcome back, valued customer!</h3>
              </div>
              <script>
                document.getElementById('spa-form').addEventListener('submit', (e) => {
                  e.preventDefault();
                  const em = document.getElementById('spa-email').value;
                  const pw = document.getElementById('spa-pass').value;
                  if (em === 'member@example.com' && pw === 'MemberPass123!') {
                    localStorage.setItem('auth_session', 'sess_token_abc123');
                    document.getElementById('auth-container').style.display = 'none';
                    document.getElementById('authenticated-area').style.display = 'block';
                  }
                });
              </script>
            </body>
          </html>
        `);
      }

      // Route 6: Custom labels, article structure, and dynamic in-page cart update
      else if (url.pathname === '/dynamic-cart-store') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Pharmacy Shop</title></head>
            <body>
              <header>
                <div class="cart-summary">Cart (<span id="cart-count">0</span> items) - Total: <span id="cart-total">$0.00</span></div>
              </header>
              <main>
                <label for="medicine-query">Medicine Name</label>
                <input id="medicine-query" type="text" aria-label="Filter medicine catalog" placeholder="Filter medicines..." />
                <button id="filter-btn">Filter</button>
                <div id="drug-list">
                  <article class="drug-item">
                    <h4>Ibuprofen 400mg</h4>
                    <span class="price">$12.50</span>
                    <button class="buy-button" id="buy-ibuprofen">Add</button>
                  </article>
                </div>
                <div id="cart-drawer" style="display:none;">
                  <h3>Shopping Cart</h3>
                  <div class="cart-item">
                    <span class="item-name">Ibuprofen 400mg</span>
                    <span class="item-qty">1</span>
                    <span class="item-price">$12.50</span>
                  </div>
                  <div class="order-total">Total: $12.50</div>
                </div>
              </main>
              <script>
                document.getElementById('buy-ibuprofen').addEventListener('click', () => {
                  document.getElementById('cart-count').innerText = '1';
                  document.getElementById('cart-total').innerText = '$12.50';
                  document.getElementById('cart-drawer').style.display = 'block';
                });
              </script>
            </body>
          </html>
        `);
      }

      // Default route
      else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><h1>Root Test Page</h1></body></html>`);
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

  it('1. discovers catalog link on homepage, traverses to separate search page, and verifies search input', async () => {
    const plan = {
      objective: 'Open homepage, discover catalog link, navigate to search, and verify search field',
      planner: 'discovery-engine',
      steps: [
        {
          id: 'step-1',
          action: 'ensureSearchPage',
          startUrl: `${baseUrl}/multipage-home`,
          expected: 'Ensure search page is discovered and active',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Search catalog...' },
          value: 'Amoxicillin',
          isSearch: true,
          expected: 'Fill search input with Amoxicillin',
        },
        {
          id: 'step-3',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Amoxicillin 250mg' },
          expected: 'Verify matching product is visible',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/multipage-home`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 3);
    assert.equal(report.passedSteps, 3);
    assert.equal(report.failedSteps, 0);

    const step1 = report.steps[0];
    assert.equal(step1.status, 'PASS');
    assert.match(step1.actual, /catalog|search/i);
  });

  it('2. verifies login redirect to dashboard with multi-signal evidence', async () => {
    const plan = {
      objective: 'Log in and verify transition to dashboard',
      planner: 'adaptive-auth',
      steps: [
        {
          id: 'step-1',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'alex@example.com',
          expected: 'Fill email',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'ValidSecret123!',
          isSensitive: true,
          expected: 'Fill password',
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          expected: 'Click Log in',
        },
        {
          id: 'step-4',
          action: 'assertAuthenticatedState',
          submittedUsername: 'alex@example.com',
          expected: 'Verify authenticated session established on dashboard',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login-redirect`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 4);
    assert.equal(report.passedSteps, 4);

    const authStep = report.steps[3];
    assert.equal(authStep.status, 'PASS');
    assert.match(authStep.actual, /navigated away from login|dashboard/i);
  });

  it('3. verifies login that succeeds without changing URL (form dismissal + localStorage token)', async () => {
    const plan = {
      objective: 'Verify SPA login succeeds without URL redirection',
      planner: 'adaptive-auth',
      steps: [
        {
          id: 'step-1',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email Address' },
          value: 'member@example.com',
          expected: 'Fill email',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'MemberPass123!',
          isSensitive: true,
          expected: 'Fill password',
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Sign in' },
          expected: 'Click Sign in',
        },
        {
          id: 'step-4',
          action: 'assertAuthenticatedState',
          submittedUsername: 'member@example.com',
          expected: 'Verify authentication succeeded via form dismissal and session storage',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/spa-login`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 4);
    assert.equal(report.passedSteps, 4);

    const authStep = report.steps[3];
    assert.equal(authStep.status, 'PASS');
    assert.match(authStep.actual, /login form dismissed|auth token/i);
  });

  it('4. observes and verifies rejection of invalid credentials (assertInvalidLogin)', async () => {
    const plan = {
      objective: 'Verify invalid credentials rejection',
      planner: 'adaptive-auth',
      steps: [
        {
          id: 'step-1',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'invalid@example.com',
          expected: 'Fill invalid email',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'WrongPass!',
          isSensitive: true,
          expected: 'Fill invalid password',
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          expected: 'Click Log in',
        },
        {
          id: 'step-4',
          action: 'assertInvalidLogin',
          expected: 'Verify observable error alert appears',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login-redirect`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 4);
    assert.equal(report.passedSteps, 4);

    const errorStep = report.steps[3];
    assert.equal(errorStep.status, 'PASS');
    assert.match(errorStep.actual, /Invalid email or password/i);
  });

  it('5. resolves custom search label and product-card article structure dynamically', async () => {
    const plan = {
      objective: 'Interact with custom labeled search and article card',
      planner: 'discovery-engine',
      steps: [
        {
          id: 'step-1',
          action: 'fill',
          target: { strategy: 'label', value: 'Medicine Name' },
          fallbacks: [{ strategy: 'placeholder', value: 'Filter medicines...' }],
          value: 'Ibuprofen',
          expected: 'Fill medicine query',
        },
        {
          id: 'step-2',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Filter' },
          expected: 'Click Filter',
        },
        {
          id: 'step-3',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Ibuprofen 400mg' },
          expected: 'Verify Ibuprofen card is visible',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/dynamic-cart-store`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 3);
    assert.equal(report.passedSteps, 3);
  });

  it('6. verifies dynamic in-page cart update (quantity and total price) without full reload', async () => {
    const plan = {
      objective: 'Add item to cart and verify live total calculation',
      planner: 'dynamic-cart',
      steps: [
        {
          id: 'step-1',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Add' },
          expected: 'Click Add to Cart',
        },
        {
          id: 'step-2',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Cart (1 items)' },
          expected: 'Verify cart quantity updated to 1',
        },
        {
          id: 'step-3',
          action: 'assertVisible',
          target: { strategy: 'text', value: 'Total: $12.50' },
          expected: 'Verify order total updated to $12.50',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/dynamic-cart-store`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.executedSteps, 3);
    assert.equal(report.passedSteps, 3);
  });

  it('7. dependency-aware recovery: auth gate failure skips dependent steps while independent search runs and passes', async () => {
    const plan = {
      objective: 'Test invalid login, skip dependent records, then continue to public search',
      planner: 'dependency-engine',
      steps: [
        {
          id: 'step-1',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Email' },
          value: 'wrong@example.com',
          flowId: 'auth',
          expected: 'Fill invalid email',
        },
        {
          id: 'step-2',
          action: 'fill',
          target: { strategy: 'placeholder', value: 'Password' },
          value: 'WrongSecret!',
          flowId: 'auth',
          expected: 'Fill invalid password',
        },
        {
          id: 'step-3',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Log in' },
          flowId: 'auth',
          expected: 'Submit credentials',
        },
        {
          id: 'step-4',
          action: 'assertAuthenticatedState',
          flowId: 'auth',
          isAuthGate: true,
          expected: 'Assert login succeeded',
        },
        // Step 5: Strictly requires auth, must be SKIPPED because auth failed
        {
          id: 'step-5',
          action: 'assertVisible',
          requiresAuth: true,
          flowId: 'auth',
          target: { strategy: 'text', value: 'Personal Health Records' },
          expected: 'View personal records (authenticated only)',
        },
        // Step 6 & 7: Independent search on public catalog, must RUN and PASS!
        {
          id: 'step-6',
          action: 'ensureSearchPage',
          requiresAuth: false,
          flowId: 'search',
          startUrl: `${baseUrl}/multipage-home`,
          expected: 'Discover and navigate to public catalog',
        },
        {
          id: 'step-7',
          action: 'assertVisible',
          requiresAuth: false,
          flowId: 'search',
          target: { strategy: 'text', value: 'Amoxicillin 250mg' },
          expected: 'Verify public catalog product is visible',
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/login-redirect`, {
      stepTimeoutMs: 5000,
      allowLocalForTesting: true,
    });

    // Step 4 failed auth gate -> marked FAIL
    // Step 5 requiresAuth: true -> marked SKIPPED (not FAIL!)
    // Step 6 & 7 independent search -> continued and PASS!
    assert.equal(report.status, 'failed'); // overall status is failed because auth failed
    assert.equal(report.totalSteps, 7);
    assert.equal(report.executedSteps, 6); // steps 1,2,3,4,6,7 executed
    assert.equal(report.skippedSteps, 1); // step 5 was skipped

    const step4 = report.steps.find((s) => s.id === 'step-4');
    assert.equal(step4.status, 'FAIL');
    assert.match(step4.actual, /Authentication failed/i);

    const step5 = report.steps.find((s) => s.id === 'step-5');
    assert.equal(step5.status, 'SKIPPED');
    assert.match(step5.actual, /Dependent on unfulfilled Step/i);

    const step6 = report.steps.find((s) => s.id === 'step-6');
    assert.equal(step6.status, 'PASS');

    const step7 = report.steps.find((s) => s.id === 'step-7');
    assert.equal(step7.status, 'PASS');
  });
});

