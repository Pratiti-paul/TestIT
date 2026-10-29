import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  validateTestDefinition,
  ALLOWED_ACTIONS,
  ALLOWED_STRATEGIES,
  SAMPLE_FUNCTIONAL_TEST,
} from '../src/utils/functionalTestValidator.js';
import { runFunctionalTest } from '../src/services/functionalTestRunner.js';
import app from '../src/app.js';

describe('Functional User-Flow Engine', () => {
  describe('Test Definition Validation', () => {
    it('approves a well-formed test definition', async () => {
      const def = {
        name: 'Valid Search Test',
        startUrl: 'https://example.com',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'fill', target: { strategy: 'placeholder', value: 'Search...' }, value: 'Test' },
          { action: 'click', target: { strategy: 'role', value: 'button', name: 'Submit' } },
          { action: 'assertVisible', target: { strategy: 'text', value: 'Results' } },
        ],
      };

      const res = await validateTestDefinition(def);
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
      assert.ok(res.normalizedDefinition);
      assert.equal(res.normalizedDefinition.steps.length, 4);
    });

    it('rejects missing or empty test name', async () => {
      const res = await validateTestDefinition({
        name: '',
        startUrl: 'https://example.com',
        steps: [{ action: 'navigate', url: 'https://example.com' }],
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('name')));
    });

    it('rejects startUrl pointing to loopback or metadata IPs', async () => {
      const res1 = await validateTestDefinition({
        name: 'SSRF Loopback Test',
        startUrl: 'http://127.0.0.1:5000',
        steps: [{ action: 'navigate', url: 'http://127.0.0.1:5000' }],
      });
      assert.equal(res1.valid, false);

      const res2 = await validateTestDefinition({
        name: 'SSRF Metadata Test',
        startUrl: 'http://169.254.169.254/latest/meta-data',
        steps: [{ action: 'navigate', url: 'http://169.254.169.254' }],
      });
      assert.equal(res2.valid, false);
    });

    it('rejects unsupported actions and strategies', async () => {
      const res = await validateTestDefinition({
        name: 'Invalid Action Test',
        startUrl: 'https://example.com',
        steps: [
          {
            action: 'evaluateScript', // Unsupported
            target: { strategy: 'magic', value: 'something' },
          },
        ],
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('unsupported')));
    });

    it('rejects navigation outside the allowed starting origin', async () => {
      const res = await validateTestDefinition({
        name: 'Cross-Origin Jump Test',
        startUrl: 'https://example.com',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'navigate', url: 'https://unauthorized-different-domain.com' },
        ],
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('cross-origin')));
    });

    it('rejects tests exceeding the maximum limit of 25 steps', async () => {
      const steps = Array.from({ length: 26 }, (_, i) => ({
        action: 'click',
        target: { strategy: 'text', value: `Button ${i}` },
      }));

      const res = await validateTestDefinition({
        name: 'Excessive Steps Test',
        startUrl: 'https://example.com',
        steps,
      });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('25 steps')));
    });
  });

  describe('Live User-Flow Execution Engine', () => {
    // Local mock website fixture for deterministic functional testing
    let server;
    let baseUrl;

    const createMockServer = () => {
      return http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Mock Store</title></head>
              <body>
                <h1>Mock Pharmacy Store</h1>
                <form id="search-form" onsubmit="event.preventDefault(); document.getElementById('results').style.display = 'block';">
                  <input id="search-input" placeholder="Search medicines..." type="text">
                  <button type="submit">Search</button>
                </form>
                <div id="results" style="display: none;">
                  <span id="product-title">Paracetamol 500mg</span>
                  <button id="add-to-cart" onclick="document.getElementById('cart-status').innerText = '1 Item in Cart';">Add to Cart</button>
                </div>
                <div id="cart-status">0 Items</div>
                <select id="quantity-select">
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
                <a href="/cart" id="cart-link">Go to Cart</a>
              </body>
            </html>
          `);
        } else if (req.url === '/cart') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Your Shopping Cart</h1>');
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
    };

    it('executes a complete multi-step functional flow successfully', async () => {
      server = createMockServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const testDef = {
        name: 'Medicine Search and Add to Cart',
        description: 'Searches for medicine, adds to cart, and verifies cart count and screenshot',
        startUrl: `${baseUrl}/`,
        steps: [
          {
            id: 'step-1',
            action: 'navigate',
            url: `${baseUrl}/`,
            description: 'Open home page',
          },
          {
            id: 'step-2',
            action: 'fill',
            target: { strategy: 'placeholder', value: 'Search medicines...' },
            value: 'Paracetamol',
            description: 'Enter search query',
          },
          {
            id: 'step-3',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Search' },
            description: 'Submit search',
          },
          {
            id: 'step-4',
            action: 'assertVisible',
            target: { strategy: 'text', value: 'Paracetamol 500mg' },
            description: 'Verify product is visible in search results',
          },
          {
            id: 'step-5',
            action: 'click',
            target: { strategy: 'text', value: 'Add to Cart' },
            description: 'Click Add to Cart',
          },
          {
            id: 'step-6',
            action: 'assertText',
            target: { strategy: 'css', value: '#cart-status' },
            value: '1 Item in Cart',
            description: 'Verify cart status updated',
          },
          {
            id: 'step-7',
            action: 'select',
            target: { strategy: 'css', value: '#quantity-select' },
            value: '2',
            description: 'Update quantity',
          },
          {
            id: 'step-8',
            action: 'screenshot',
            name: 'Final cart state',
            description: 'Capture screenshot of final state',
          },
        ],
      };

      try {
        const report = await runFunctionalTest(testDef, { allowLocalForTesting: true });

        assert.equal(report.status, 'passed');
        assert.equal(report.totalSteps, 8);
        assert.equal(report.passedSteps, 8);
        assert.equal(report.failedSteps, 0);
        assert.ok(report.durationMs > 0);

        const screenshotStep = report.steps.find((s) => s.action === 'screenshot');
        assert.ok(screenshotStep);
        assert.ok(screenshotStep.screenshot.startsWith('data:image/png;base64,'));
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('reports failure accurately when an assertion fails and captures failure screenshot', async () => {
      server = createMockServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const failingTestDef = {
        name: 'Failing Text Assertion Test',
        startUrl: `${baseUrl}/`,
        steps: [
          {
            action: 'navigate',
            url: `${baseUrl}/`,
          },
          {
            action: 'assertText',
            target: { strategy: 'css', value: '#cart-status' },
            value: '99 Items in Cart', // Deliberate mismatch
          },
        ],
      };

      try {
        const report = await runFunctionalTest(failingTestDef, { allowLocalForTesting: true });

        assert.equal(report.status, 'failed');
        assert.equal(report.passedSteps, 1);
        assert.equal(report.failedSteps, 1);

        const failedStep = report.steps[1];
        assert.equal(failedStep.status, 'failed');
        assert.ok(failedStep.actual.includes('Text assertion failed'));
        assert.ok(failedStep.screenshot, 'Expected failure screenshot');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('handles missing elements and step timeouts cleanly without crashing', async () => {
      server = createMockServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const timeoutTestDef = {
        name: 'Missing Element Timeout Test',
        startUrl: `${baseUrl}/`,
        steps: [
          {
            action: 'click',
            target: { strategy: 'text', value: 'Non-Existent-Button' },
            timeoutMs: 600, // Short timeout for rapid test execution
          },
        ],
      };

      try {
        const report = await runFunctionalTest(timeoutTestDef, { allowLocalForTesting: true });

        assert.equal(report.status, 'failed');
        assert.equal(report.failedSteps, 1);
        assert.equal(report.steps[0].status, 'error');
        assert.ok(report.failure);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('Functional Test API Endpoints', () => {
    let apiServer;
    let apiBaseUrl;

    before(async () => {
      await new Promise((resolve) => {
        apiServer = app.listen(0, '127.0.0.1', () => {
          apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
          resolve();
        });
      });
    });

    after(async () => {
      if (apiServer) {
        await new Promise((resolve) => apiServer.close(resolve));
      }
    });

    it('GET /api/functional-tests/schema returns schema and sample definition', async () => {
      const res = await fetch(`${apiBaseUrl}/api/functional-tests/schema`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.deepEqual(json.data.supportedActions, ALLOWED_ACTIONS);
      assert.deepEqual(json.data.supportedStrategies, ALLOWED_STRATEGIES);
      assert.ok(json.data.sampleTest);
      assert.equal(json.data.sampleTest.steps.length, 4);
    });

    it('POST /api/functional-tests/validate validates definition without running it', async () => {
      const validRes = await fetch(`${apiBaseUrl}/api/functional-tests/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_FUNCTIONAL_TEST),
      });
      assert.equal(validRes.status, 200);
      const validJson = await validRes.json();
      assert.equal(validJson.valid, true);

      const invalidRes = await fetch(`${apiBaseUrl}/api/functional-tests/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', startUrl: '' }),
      });
      assert.equal(invalidRes.status, 400);
      const invalidJson = await invalidRes.json();
      assert.equal(invalidJson.valid, false);
      assert.ok(invalidJson.errors.length > 0);
    });
  });
});
