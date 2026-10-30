import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { executeAiAgent } from '../src/services/aiAgentService.js';

class MockProvider {
  constructor(steps, plannedObjectives = null) {
    this.name = 'gemini';
    this.model = 'gemini-3.5-flash-lite';
    this.steps = steps;
    this.plannedObjectives = plannedObjectives || [
      {
        id: 'obj-1',
        description: 'Execute component action and verify outcome',
        targetBehavior: 'Component interaction',
        requiresAuth: false,
        dependsOn: [],
      },
    ];
    this.stepIndex = 0;
  }

  async planObjectives() {
    return {
      objectives: this.plannedObjectives,
      reasoning: 'Plan for contextual component scoping and recovery tests',
    };
  }

  async decideNextStep() {
    if (this.stepIndex < this.steps.length) {
      return this.steps[this.stepIndex++];
    }
    return {
      thought: 'All test steps finished, concluding PASS',
      action: 'conclude',
      conclude: {
        outcome: 'PASS',
        reasoning: 'Executed all test decisions successfully.',
      },
    };
  }
}

describe('Phase 4.9: Contextual Component Scoping & Action Recovery Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // ----------------------------------------------------------------------
      // FIXTURE 1: Two identical buttons inside different cards
      // ----------------------------------------------------------------------
      if (url.pathname === '/two-cards') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Subscription Plans</title></head>
            <body>
              <h1>Select Your Tier</h1>
              <div class="pricing-grid">
                <div class="pricing-card" id="card-starter">
                  <h3>Starter Tier</h3>
                  <p class="price">$10/mo</p>
                  <p class="desc">For individual developers</p>
                  <div class="btn-wrap">
                    <button class="sub-btn" onclick="document.getElementById('result').innerText = 'Starter Subscribed';">Subscribe</button>
                  </div>
                </div>
                <div class="pricing-card" id="card-enterprise">
                  <h3>Enterprise Tier</h3>
                  <p class="price">$100/mo</p>
                  <p class="desc">For high-scale enterprise teams</p>
                  <div class="btn-wrap">
                    <button class="sub-btn" onclick="document.getElementById('result').innerText = 'Enterprise Subscribed';">Subscribe</button>
                  </div>
                </div>
              </div>
              <div id="result" role="status">None</div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 2: Repeated table rows with identical action buttons
      // ----------------------------------------------------------------------
      if (url.pathname === '/table-rows') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Team Management</title></head>
            <body>
              <h1>User Directory</h1>
              <table id="users-table">
                <thead><tr><th>Name</th><th>Email</th><th>Actions</th></tr></thead>
                <tbody>
                  <tr id="row-alice">
                    <td>Alice Cooper</td>
                    <td>alice@example.com</td>
                    <td><button class="edit-btn" onclick="document.getElementById('edit-modal').innerText = 'Editing Alice Cooper'; document.getElementById('edit-modal').style.display = 'block';">Edit Profile</button></td>
                  </tr>
                  <tr id="row-bob">
                    <td>Bob Vance</td>
                    <td>bob@example.com</td>
                    <td><button class="edit-btn" onclick="document.getElementById('edit-modal').innerText = 'Editing Bob Vance'; document.getElementById('edit-modal').style.display = 'block';">Edit Profile</button></td>
                  </tr>
                  <tr id="row-charlie">
                    <td>Charlie Brown</td>
                    <td>charlie@example.com</td>
                    <td><button class="edit-btn" onclick="document.getElementById('edit-modal').innerText = 'Editing Charlie Brown'; document.getElementById('edit-modal').style.display = 'block';">Edit Profile</button></td>
                  </tr>
                </tbody>
              </table>
              <div id="edit-modal" style="display:none;" role="dialog"></div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 3: Multiple search results with separate action buttons
      // ----------------------------------------------------------------------
      if (url.pathname === '/search-results') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Catalog Search</title></head>
            <body>
              <h1>Product Catalog</h1>
              <div class="search-listing">
                <article class="product-item" id="item-paracetamol">
                  <h4>Paracetamol 500mg</h4>
                  <p class="desc">Fast pain and fever relief tablets</p>
                  <span class="price">₹30</span>
                  <div class="action-wrap">
                    <button class="cart-btn" onclick="document.getElementById('cart-status').innerText = 'Paracetamol 500mg added to cart'; document.getElementById('cart-badge').innerText = '1';">Add to Cart</button>
                  </div>
                </article>
                <article class="product-item" id="item-amoxicillin">
                  <h4>Amoxicillin 250mg</h4>
                  <p class="desc">Broad-spectrum antibiotic capsules</p>
                  <span class="price">₹65</span>
                  <div class="action-wrap">
                    <button class="cart-btn" onclick="document.getElementById('cart-status').innerText = 'Amoxicillin 250mg added to cart'; document.getElementById('cart-badge').innerText = '1';">Add to Cart</button>
                  </div>
                </article>
                <article class="product-item" id="item-cetirizine">
                  <h4>Cetirizine 10mg</h4>
                  <p class="desc">Antihistamine for seasonal allergy relief</p>
                  <span class="price">₹25</span>
                  <div class="action-wrap">
                    <button class="cart-btn" onclick="document.getElementById('cart-status').innerText = 'Cetirizine 10mg added to cart'; document.getElementById('cart-badge').innerText = '1';">Add to Cart</button>
                  </div>
                </article>
              </div>
              <div id="cart-status" role="status">Cart is empty</div>
              <span id="cart-badge">0</span>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 4: Nested containers with buttons belonging to different components
      // ----------------------------------------------------------------------
      if (url.pathname === '/nested-containers') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Bundle Offers</title></head>
            <body>
              <h1>Special Bundles</h1>
              <section class="bundle-card" id="bundle-laptop">
                <h3>Laptop Pro Workspace</h3>
                <p>Complete laptop workstation package</p>
                <div class="bundle-actions">
                  <button class="action-btn" onclick="document.getElementById('selection').innerText = 'Laptop Pro Workspace Selected';">Select Bundle</button>
                </div>
                <div class="nested-accessory" id="addon-mouse">
                  <h5>Wireless Precision Mouse</h5>
                  <p>Optional ergonomic wireless mouse add-on</p>
                  <div class="addon-actions">
                    <button class="action-btn" onclick="document.getElementById('selection').innerText = 'Wireless Precision Mouse Selected';">Select Bundle</button>
                  </div>
                </div>
              </section>
              <div id="selection" role="status">None</div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 5: Single component with multiple unrelated controls
      // ----------------------------------------------------------------------
      if (url.pathname === '/component-multiple-controls') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Account Center</title></head>
            <body>
              <h1>Security Center</h1>
              <section class="card panel" id="security-panel">
                <h3>Two-Factor Authentication Preferences</h3>
                <p>Configure authenticator app and SMS backup settings</p>
                <div class="controls-group">
                  <button id="save-btn" onclick="document.getElementById('feedback').innerText = '2FA Preferences Saved';">Save Changes</button>
                  <button id="reset-btn" onclick="document.getElementById('feedback').innerText = 'Preferences Reset';">Reset Defaults</button>
                  <button id="export-btn" onclick="document.getElementById('feedback').innerText = 'Audit Log Exported';">Export Audit Log</button>
                </div>
              </section>
              <div id="feedback" role="status">Idle</div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 6: Genuine ambiguity where two components are equally valid
      // ----------------------------------------------------------------------
      if (url.pathname === '/duplicate-components') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Flash Sale</title></head>
            <body>
              <h1>Deals of the Day</h1>
              <div class="deal-card">
                <h3>Generic Voucher Alpha</h3>
                <p class="price">$25 voucher</p>
                <button class="claim-btn">Claim Voucher</button>
              </div>
              <div class="deal-card">
                <h3>Generic Voucher Alpha</h3>
                <p class="price">$25 voucher</p>
                <button class="claim-btn">Claim Voucher</button>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 7: Dead click followed by successful locator recovery
      // ----------------------------------------------------------------------
      if (url.pathname === '/dead-click-recovered') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Checkout</title></head>
            <body>
              <h1>Order Review</h1>
              <div class="product-card" id="order-card">
                <h3>Premium Subscription</h3>
                <div class="btn-outer" onclick="/* dead click wrapper */">
                  <button id="active-submit-btn" onclick="document.getElementById('order-status').innerText = 'Order Successfully Placed!'; document.getElementById('order-status').style.display = 'block';">Place Order</button>
                </div>
              </div>
              <div id="order-status" style="display:none;" role="status"></div>
            </body>
          </html>
        `);
        return;
      }

      // ----------------------------------------------------------------------
      // FIXTURE 8: Dead click where recovery fails and action remains unverified
      // ----------------------------------------------------------------------
      if (url.pathname === '/dead-click-unverified') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>System Operations</title></head>
            <body>
              <h1>Database Maintenance</h1>
              <div class="op-panel">
                <h3>Purge Expired Records</h3>
                <button id="dead-btn">Purge Now</button>
              </div>
              <div id="status-panel">System online</div>
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
  // Test 1: Two identical buttons inside different cards
  // ==========================================================================
  it('1. disambiguates identical buttons across different cards using contextual entity text ("Enterprise Tier")', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Subscribe for Enterprise Tier to choose the enterprise plan',
        action: 'click',
        target: { strategy: 'text', value: 'Subscribe' },
        expectedOutcome: 'Enterprise Tier selected',
      },
      {
        thought: 'Verify that Enterprise Subscribed is displayed',
        action: 'assertText',
        target: { strategy: 'css', value: '#result' },
        value: 'Enterprise Subscribed',
        expectedOutcome: 'Enterprise Subscribed text is visible',
      },
      {
        thought: 'Plan selected and verified, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Enterprise plan successfully subscribed.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/two-cards`,
        instructions: 'Subscribe to Enterprise Tier and verify subscription status',
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
  // Test 2: Repeated table rows with identical action buttons
  // ==========================================================================
  it('2. scopes action button resolution to the intended table row ("Bob Vance")', async () => {
    const mockProvider = new MockProvider([
      {
        thought: "Click Edit Profile for 'Bob Vance' to open user edit dialog",
        action: 'click',
        target: { strategy: 'text', value: 'Edit Profile' },
        expectedOutcome: 'Edit dialog for Bob Vance opened',
      },
      {
        thought: 'Verify edit modal displays Editing Bob Vance',
        action: 'assertText',
        target: { strategy: 'css', value: '#edit-modal' },
        value: 'Editing Bob Vance',
        expectedOutcome: 'Editing Bob Vance text is present',
      },
      {
        thought: 'Verified Bob Vance was edited, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Successfully scoped Edit Profile to Bob Vance.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/table-rows`,
        instructions: 'Click Edit Profile for Bob Vance and verify the edit dialog appears',
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
  // Test 3: Multiple search results with separate action buttons
  // ==========================================================================
  it('3. identifies the correct search result component for "Paracetamol 500mg" and adds to cart', async () => {
    const mockProvider = new MockProvider([
      {
        thought: "Click Add to Cart for 'Paracetamol 500mg' to add medicine to cart",
        action: 'click',
        target: { strategy: 'text', value: 'Add to Cart' },
        expectedOutcome: 'Paracetamol added to cart',
      },
      {
        thought: 'Verify cart status displays Paracetamol 500mg added to cart',
        action: 'assertText',
        target: { strategy: 'css', value: '#cart-status' },
        value: 'Paracetamol 500mg added to cart',
        expectedOutcome: 'Cart status shows Paracetamol',
      },
      {
        thought: 'Paracetamol added and verified, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Paracetamol 500mg correctly added to cart.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/search-results`,
        instructions: 'Add Paracetamol 500mg to the cart and verify cart status',
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
  // Test 4: Nested containers with buttons belonging to different components
  // ==========================================================================
  it('4. distinguishes a nested sub-component button from its parent container button ("Wireless Precision Mouse")', async () => {
    const mockProvider = new MockProvider([
      {
        thought: "Click Select Bundle for 'Wireless Precision Mouse' addon",
        action: 'click',
        target: { strategy: 'text', value: 'Select Bundle' },
        expectedOutcome: 'Wireless Precision Mouse selected',
      },
      {
        thought: 'Verify that Wireless Precision Mouse Selected is displayed',
        action: 'assertText',
        target: { strategy: 'css', value: '#selection' },
        value: 'Wireless Precision Mouse Selected',
        expectedOutcome: 'Selection shows mouse addon',
      },
      {
        thought: 'Nested component selected, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Correctly scoped to nested addon component.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/nested-containers`,
        instructions: 'Select Wireless Precision Mouse and verify selection',
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
  // Test 5: Single component with multiple unrelated controls
  // ==========================================================================
  it('5. resolves the specific control ("Save Changes") within a multi-control component panel', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Save Changes within the Two-Factor Authentication Preferences card',
        action: 'click',
        target: { strategy: 'text', value: 'Save Changes' },
        expectedOutcome: '2FA settings saved',
      },
      {
        thought: 'Verify feedback shows 2FA Preferences Saved',
        action: 'assertText',
        target: { strategy: 'css', value: '#feedback' },
        value: '2FA Preferences Saved',
        expectedOutcome: 'Feedback message updated',
      },
      {
        thought: 'Settings saved and verified, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Save Changes executed inside security panel.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/component-multiple-controls`,
        instructions: 'Save 2FA preferences in Security Center and verify confirmation',
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
  // Test 6: Genuine ambiguity where two components are equally valid
  // ==========================================================================
  it('6. safely halts as blocked when two duplicate components are equally valid and cannot be disambiguated', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Claim Voucher',
        action: 'click',
        target: { strategy: 'text', value: 'Claim Voucher' },
        expectedOutcome: 'Voucher claimed',
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/duplicate-components`,
        instructions: 'Claim the voucher',
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

  // ==========================================================================
  // Test 7: Dead click followed by successful locator recovery
  // ==========================================================================
  it('7. recovers from a dead click on a wrapper by discovering the active control inside the component', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click the Place Order wrapper inside the order card',
        action: 'click',
        target: { strategy: 'css', value: '.btn-outer' },
        expectedOutcome: 'Order placed',
      },
      {
        thought: 'Verify order status displays Order Successfully Placed!',
        action: 'assertVisible',
        target: { strategy: 'css', value: '#order-status' },
        expectedOutcome: 'Order status banner is visible',
      },
      {
        thought: 'Order verified, conclude PASS',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Order successfully placed via recovery.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/dead-click-recovered`,
        instructions: 'Place order and verify confirmation',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'passed', `Expected test to pass via action recovery, got: ${report.status}`);
    const clickStep = report.steps.find((s) => s.action === 'click');
    assert.ok(clickStep);
    assert.match(clickStep.actual, /recovered|observed update|dispatched successfully/i);
  });

  // ==========================================================================
  // Test 8: Dead click where recovery fails and action remains unverified
  // ==========================================================================
  it('8. prevents false-positive PASS when dead click cannot be recovered and expected state is unverified', async () => {
    const mockProvider = new MockProvider([
      {
        thought: 'Click Purge Now button to trigger database purge',
        action: 'click',
        target: { strategy: 'text', value: 'Purge Now' },
        expectedOutcome: 'Database purged confirmation',
      },
      {
        thought: 'Purge button clicked, conclude PASS without verifying change',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Button was clicked.' },
      },
    ]);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/dead-click-unverified`,
        instructions: 'Purge database and verify status update',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
      }
    );

    assert.strictEqual(report.status, 'failed', `Expected failed outcome for unverified dead click, got: ${report.status}`);
    assert.match(
      report.failure?.description || '',
      /dead click|no-op|no observable/i,
      'Should report dead click failure'
    );
  });
});

