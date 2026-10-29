import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runAiTest } from '../src/services/aiTestRunner.js';
import { discoverWebsite } from '../src/services/websiteDiscoveryService.js';
import { generateDeterministicPlan, extractSearchQuery } from '../src/services/aiPlannerService.js';

describe('Generic Website Discovery & Browser Automation (Non-Pharmacy Domain)', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // 1. Homepage without search input (only navigation links)
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>TechStore - Electronic Gadgets</title></head>
            <body>
              <header>
                <a href="/" class="navbar-brand">TechStore</a>
                <nav>
                  <a href="/">Home</a>
                  <a href="/catalog">Catalog</a>
                  <a href="/cart" class="cart-icon">🛒</a>
                  <a href="/account/login">Sign in</a>
                </nav>
              </header>
              <main>
                <h1>Next-Gen Consumer Electronics</h1>
                <p>Browse our catalog for cutting-edge devices.</p>
              </main>
            </body>
          </html>
        `);
      }

      // 2. Separate catalog page with search input and article cards
      else if (url.pathname === '/catalog') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>TechStore - Product Catalog</title></head>
            <body>
              <header>
                <a href="/" class="navbar-brand">TechStore</a>
                <nav>
                  <a href="/">Home</a>
                  <a href="/catalog">Catalog</a>
                  <a href="/cart" class="cart-icon">🛒</a>
                </nav>
              </header>
              <main>
                <h2>Product Catalog</h2>
                <div class="search-bar">
                  <input type="search" id="product-search" placeholder="Search gadgets..." />
                  <button id="search-btn" type="submit">Search</button>
                </div>
                <div id="results-container">
                  <article class="item-card" data-testid="product-card">
                    <h3 class="product-title">Noise Cancelling Headphones</h3>
                    <span class="price">$199.99</span>
                    <button class="add-to-cart-btn" onclick="addToCart('Noise Cancelling Headphones', '$199.99')">Add to Cart</button>
                  </article>
                  <article class="item-card" data-testid="product-card">
                    <h3 class="product-title">Mechanical Gaming Keyboard</h3>
                    <span class="price">$89.99</span>
                    <button class="add-to-cart-btn" onclick="addToCart('Mechanical Gaming Keyboard', '$89.99')">Add to Cart</button>
                  </article>
                </div>
              </main>
              <script>
                function addToCart(title, price) {
                  localStorage.setItem('cart_item', JSON.stringify({ title, price }));
                }
                document.getElementById('search-btn').addEventListener('click', () => {
                  const q = document.getElementById('product-search').value.toLowerCase();
                  document.querySelectorAll('.item-card').forEach(card => {
                    card.style.display = card.innerText.toLowerCase().includes(q) ? 'block' : 'none';
                  });
                });
              </script>
            </body>
          </html>
        `);
      }

      // 3. Cart view
      else if (url.pathname === '/cart') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>TechStore - Shopping Cart</title></head>
            <body>
              <header>
                <a href="/" class="navbar-brand">TechStore</a>
              </header>
              <main class="cart-page">
                <h2>Your Shopping Cart</h2>
                <div class="cart-items-container">
                  <div class="cart-item">
                    <span class="item-name">Noise Cancelling Headphones</span>
                    <span class="item-qty">1</span>
                    <span class="item-price">$199.99</span>
                  </div>
                </div>
                <div class="order-summary">
                  <p>Total: $199.99</p>
                </div>
              </main>
            </body>
          </html>
        `);
      }

      // 4. Login page with logo link returning to homepage
      else if (url.pathname === '/account/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>TechStore - Member Login</title></head>
            <body>
              <header>
                <a href="/" class="navbar-brand">TechStore</a>
              </header>
              <main>
                <h2>Sign In</h2>
                <form id="login-form">
                  <input type="email" placeholder="Email" id="email" />
                  <input type="password" placeholder="Password" id="password" />
                  <button type="submit">Log in</button>
                </form>
              </main>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. discovers generic catalog page and article cards without pharmacy assumptions', async () => {
    const discovery = await discoverWebsite(`${baseUrl}/`, {
      maxPages: 3,
      allowLocal: true,
      priorityKeywords: ['catalog', 'electronics', 'headphones'],
    });

    assert.ok(discovery);
    assert.ok(discovery.totalPagesExplored >= 2);
    assert.ok(discovery.catalogPageUrl, 'Discovered catalog page URL');
    assert.match(discovery.catalogPageUrl, /\/catalog/);

    // Verify catalog structure
    const catalogPage = discovery.pages.find((p) => p.url === discovery.catalogPageUrl);
    assert.ok(catalogPage);
    assert.equal(catalogPage.capabilities.hasSearchField, true);
    assert.equal(catalogPage.capabilities.hasCatalogItems, true);
  });

  it('2. recovers from login page back to homepage using generic navbar-brand locator', async () => {
    const plan = {
      objective: 'Navigate from login to search interface and search for headphones',
      steps: [
        {
          id: 'step-1',
          action: 'navigate',
          url: `${baseUrl}/account/login`,
          description: 'Navigate to login page',
          expected: 'Landed on login page',
          timeoutMs: 4000,
        },
        {
          id: 'step-2',
          action: 'ensureSearchPage',
          startUrl: `${baseUrl}/`,
          description: 'Ensure search page is active by navigating from login to catalog',
          expected: 'Catalog page with search input is active',
          timeoutMs: 5000,
        },
      ],
    };

    const report = await runAiTest(plan, `${baseUrl}/account/login`, { allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.passedSteps, 2);
    assert.equal(report.failedSteps, 0);
  });

  it('3. executes planned generic search and cart flow on non-pharmacy electronics store', async () => {
    const plan = generateDeterministicPlan({
      url: `${baseUrl}/`,
      instructions: 'Search for "Noise Cancelling Headphones", add first result to cart, and verify total price',
    });

    assert.equal(plan.status, 'ready');

    const report = await runAiTest(plan, `${baseUrl}/`, { allowLocalForTesting: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.failedSteps, 0);
    assert.ok(report.executedSteps >= 4);

    // Verify step results
    const fillStepResult = report.steps.find((s) => s.action === 'fill');
    assert.ok(fillStepResult);
    assert.equal(fillStepResult.status, 'PASS');
    assert.match(fillStepResult.actual, /Noise Cancelling Headphones/);
  });

  it('4. extractSearchQuery accurately identifies queries without fabricating keywords', () => {
    assert.equal(extractSearchQuery('Search for "Wireless Mouse" and verify'), 'Wireless Mouse');
    assert.equal(extractSearchQuery('search for iPhone 15 and add to cart'), 'iPhone 15');
    assert.equal(extractSearchQuery('Find Mechanical Keyboard, then check price'), 'Mechanical Keyboard');
    assert.equal(extractSearchQuery('Search shoes and add to cart'), 'shoes');

    // Generic instructions must return null
    assert.equal(extractSearchQuery('Search for products and add to cart'), null);
    assert.equal(extractSearchQuery('Test search functionality'), null);
    assert.equal(extractSearchQuery('Search items in catalog'), null);
    assert.equal(extractSearchQuery('Find something to buy'), null);
  });
});

