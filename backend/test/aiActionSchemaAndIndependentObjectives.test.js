import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import {
  validateAgentDecision,
  repairTargetStrategy,
  LOCATOR_STRATEGIES,
  AGENT_ACTIONS,
  MockProvider,
} from '../src/services/aiProvider/index.js';
import {
  executeAiAgent,
  detectActionReasoningMismatch,
  checkObjectiveDependencies,
} from '../src/services/aiAgentService.js';

describe('Phase 5.0A: AI Action Schema Reliability & Independent Objective Execution', () => {
  // Helper to spin up ephemeral HTTP server for live Playwright fixture tests
  const createFixtureServer = (htmlContent) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
    });
    return new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        resolve({
          server,
          url: `http://localhost:${port}`,
          close: () => new Promise((res) => server.close(res)),
        });
      });
    });
  };

  // ==========================================================================
  // Test 1: Gemini returns supported `role` strategy
  // ==========================================================================
  it('1. validates that supported "role" strategy conforms directly to canonical action schema', () => {
    const geminiDecision = {
      thought: 'Click the Submit button using accessible role',
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Submit' },
      expectedOutcome: 'Form submitted successfully',
    };

    const result = validateAgentDecision(geminiDecision);
    assert.strictEqual(result.valid, true, 'Supported role strategy should be valid');
    assert.strictEqual(result.repaired, undefined, 'No repair needed for canonical role strategy');
    assert.strictEqual(geminiDecision.target.strategy, 'role');
    assert.strictEqual(geminiDecision.target.value, 'button');
    assert.strictEqual(geminiDecision.target.name, 'Submit');
  });

  // ==========================================================================
  // Test 2: Gemini returns unsupported `name` strategy
  // ==========================================================================
  it('2. detects when model returns unsupported "name" strategy when repair is disabled', () => {
    const geminiDecision = {
      thought: 'Fill the user-name input field using name attribute',
      action: 'fill',
      target: { strategy: 'name', value: 'user-name' },
      value: 'standard_user',
      expectedOutcome: 'Username input is populated',
    };

    // When strict validation is run without repair
    const result = validateAgentDecision(geminiDecision, { allowRepair: false });
    assert.strictEqual(result.valid, false, 'Raw "name" strategy must be flagged as invalid');
    assert.match(
      result.error,
      /Target strategy "name" is invalid\. Allowed: role, label, placeholder, text, css\./i,
      'Error message must specify allowed strategies'
    );
  });

  // ==========================================================================
  // Test 3: Unsupported strategy is safely repaired
  // ==========================================================================
  it('3. safely repairs unsupported "name" strategy into canonical CSS attribute selector and executes', async () => {
    const rawTarget = { strategy: 'name', value: 'user-name' };
    const repairResult = repairTargetStrategy(rawTarget);

    assert.strictEqual(repairResult.repaired, true, 'Strategy "name" should be repaired');
    assert.strictEqual(repairResult.target.strategy, 'css');
    assert.strictEqual(repairResult.target.value, '[name="user-name"]');
    assert.strictEqual(repairResult.repairDetails.originalStrategy, 'name');
    assert.strictEqual(repairResult.repairDetails.repairedStrategy, 'css');

    // Also verify live browser execution with auto-repaired decision
    const fixture = await createFixtureServer(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="login-form">
            <input type="text" name="user-name" id="user-name" placeholder="Username" />
            <button type="submit" id="btn-submit">Sign In</button>
          </form>
        </body>
      </html>
    `);

    try {
      const mockProvider = new MockProvider([
        {
          thought: 'Fill the user-name input using unsupported name strategy',
          action: 'fill',
          target: { strategy: 'name', value: 'user-name' },
          value: 'test_user',
          expectedOutcome: 'Username field filled with test_user',
        },
        {
          thought: 'Conclude step',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'Input filled successfully via repaired selector' },
        },
      ]);

      const report = await executeAiAgent(
        {
          url: fixture.url,
          instructions: 'Fill the user-name field',
        },
        {
          provider: mockProvider,
          allowLocalForTesting: true,
          maxSteps: 3,
        }
      );

      assert.strictEqual(report.status, 'passed', `Expected passed, got ${report.status}`);
      const fillStep = report.steps.find((s) => s.action === 'fill');
      assert.ok(fillStep, 'Fill step should be executed');
      assert.match(fillStep.actual, /Filled input with "test_user"/);
    } finally {
      await fixture.close();
    }
  });

  // ==========================================================================
  // Test 4: Repair fails and produces structured error
  // ==========================================================================
  it('4. fails cleanly and returns structured error when strategy cannot be safely repaired', () => {
    const invalidDecision = {
      thought: 'Try unknown locator strategy',
      action: 'click',
      target: { strategy: 'magic_ai_locator', value: 'random_element' },
      expectedOutcome: 'Clicked magic element',
    };

    const result = validateAgentDecision(invalidDecision, { allowRepair: true });
    assert.strictEqual(result.valid, false, 'Arbitrary strategy must not be repaired');
    assert.match(
      result.error,
      /Target strategy "magic_ai_locator" is invalid and cannot be safely repaired/i
    );
  });

  // ==========================================================================
  // Test 5: OpenAI uses the same canonical schema
  // ==========================================================================
  it('5. verifies that OpenAI decisions adhere to the exact same canonical action and strategy schema', () => {
    // Both providers share AGENT_ACTIONS and LOCATOR_STRATEGIES
    assert.deepStrictEqual(LOCATOR_STRATEGIES, ['role', 'label', 'placeholder', 'text', 'css']);
    assert.ok(AGENT_ACTIONS.includes('click'));
    assert.ok(AGENT_ACTIONS.includes('fill'));
    assert.ok(AGENT_ACTIONS.includes('conclude'));

    const openAiDecision = {
      thought: 'OpenAI decision selecting pricing tier using css selector',
      action: 'click',
      target: { strategy: 'css', value: '[data-tier="pro"] button' },
      expectedOutcome: 'Pro tier selected',
    };

    const result = validateAgentDecision(openAiDecision);
    assert.strictEqual(result.valid, true);

    // Unsupported strategy in OpenAI also repairs identically
    const openAiNameDecision = {
      thought: 'OpenAI decision using name attribute',
      action: 'fill',
      target: { strategy: 'name', value: 'postal-code' },
      value: '90210',
      expectedOutcome: 'Postal code filled',
    };
    const repairResult = validateAgentDecision(openAiNameDecision, { allowRepair: true });
    assert.strictEqual(repairResult.valid, true);
    assert.strictEqual(repairResult.repaired, true);
    assert.strictEqual(openAiNameDecision.target.strategy, 'css');
    assert.strictEqual(openAiNameDecision.target.value, '[name="postal-code"]');
  });

  // ==========================================================================
  // Test 6: Intended value matches actual filled value
  // ==========================================================================
  it('6. guarantees intended test username ("problem_user") is preserved and not overwritten by supplied credentials', async () => {
    const fixture = await createFixtureServer(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="login">
            <input type="text" name="user-name" id="user-name" />
            <input type="password" name="password" id="password" />
            <button type="submit" id="login-button">Login</button>
          </form>
        </body>
      </html>
    `);

    try {
      const mockProvider = new MockProvider([
        {
          thought: 'Test the application with problem_user to verify error handling for problem user',
          action: 'fill',
          target: { strategy: 'css', value: '#user-name' },
          value: 'problem_user',
          expectedOutcome: 'problem_user entered into username field',
        },
        {
          thought: 'Conclude step',
          action: 'conclude',
          conclude: { outcome: 'PASS', reasoning: 'problem_user successfully entered' },
        },
      ]);

      // User supplied "standard_user" in credentials form
      const report = await executeAiAgent(
        {
          url: fixture.url,
          instructions: 'Test problem_user login',
        },
        {
          provider: mockProvider,
          allowLocalForTesting: true,
          credentials: { username: 'standard_user', password: 'secret_sauce' },
          maxSteps: 3,
        }
      );

      assert.strictEqual(report.status, 'passed');
      const fillStep = report.steps.find((s) => s.action === 'fill');
      assert.ok(fillStep);
      // Actual filled value must match problem_user, NOT standard_user!
      assert.strictEqual(fillStep.actual, 'Filled input with "problem_user"');
    } finally {
      await fixture.close();
    }
  });

  // ==========================================================================
  // Test 7: Model reasoning and executed action mismatch is detected
  // ==========================================================================
  it('7. detects when model reasoning intends "problem_user" but action specifies a mismatched value, and safely reconciles', () => {
    const mismatchedDecision = {
      thought: 'I will enter "problem_user" into the username input to test problem user layout glitches',
      action: 'fill',
      target: { strategy: 'css', value: '#user-name' },
      value: '[VALID_USERNAME]', // Mismatch! Reasoning specified problem_user, but value has placeholder
    };

    const reconciliation = detectActionReasoningMismatch(mismatchedDecision, {
      credentials: { username: 'standard_user', password: 'secret_sauce' },
    });

    assert.strictEqual(reconciliation.valid, true);
    assert.strictEqual(reconciliation.mismatch, true, 'Mismatch between reasoning and action value must be detected');
    assert.strictEqual(reconciliation.repaired, true);
    assert.strictEqual(reconciliation.details.intendedFromReasoning, 'problem_user');
    assert.strictEqual(reconciliation.details.actionValue, '[VALID_USERNAME]');
    assert.strictEqual(mismatchedDecision.value, 'problem_user', 'Action value must be repaired to match intended reasoning');
  });

  // ==========================================================================
  // Test 8: Invalid login objective failure does not skip independent objectives
  // ==========================================================================
  it('8. ensures invalid login objective failure does not skip independent subsequent objectives', () => {
    const plannedObjectives = [
      {
        id: 'obj-1',
        description: 'Test invalid login credentials rejection',
        targetBehavior: 'Verify invalid login rejection',
        requiresCredentials: false,
        requiresAuth: false,
        dependsOn: [],
      },
      {
        id: 'obj-2',
        description: 'Test valid login with standard credentials',
        targetBehavior: 'Verify valid authentication',
        requiresCredentials: true,
        requiresAuth: false,
        dependsOn: ['obj-1'], // Model may have listed obj-1 as dependsOn
      },
      {
        id: 'obj-3',
        description: 'Inspect public landing page features and catalog',
        targetBehavior: 'Public catalog verification',
        requiresAuth: false,
        dependsOn: ['obj-1'],
      },
    ];

    const failedObjectiveIds = new Set(['obj-1']); // obj-1 failed

    // Test obj-2 (valid login) dependency check
    const depCheckObj2 = checkObjectiveDependencies(plannedObjectives[1], {
      failedObjectiveIds,
      authFailed: false, // Invalid login failure does NOT mean valid auth failed
      authSucceeded: false,
      credentials: { username: 'standard_user', password: 'secret_sauce' },
      plannedObjectives,
    });

    assert.strictEqual(
      depCheckObj2.canRun,
      true,
      'Valid login objective must NOT be skipped when invalid login fails'
    );

    // Test obj-3 (public catalog) dependency check
    const depCheckObj3 = checkObjectiveDependencies(plannedObjectives[2], {
      failedObjectiveIds,
      authFailed: false,
      authSucceeded: false,
      credentials: { username: 'standard_user', password: 'secret_sauce' },
      plannedObjectives,
    });

    assert.strictEqual(
      depCheckObj3.canRun,
      true,
      'Public feature objective must NOT be skipped when invalid login fails'
    );
  });

  // ==========================================================================
  // Test 9: Protected objective is skipped when authentication genuinely fails
  // ==========================================================================
  it('9. ensures protected workflow objective is skipped when valid authentication genuinely fails', () => {
    const plannedObjectives = [
      {
        id: 'obj-1',
        description: 'Test valid login',
        targetBehavior: 'Verify valid authentication',
        requiresCredentials: true,
        requiresAuth: false,
        dependsOn: [],
      },
      {
        id: 'obj-2',
        description: 'Add product to cart and complete checkout',
        targetBehavior: 'Protected checkout flow',
        requiresAuth: true,
        dependsOn: ['obj-1'],
      },
    ];

    const failedObjectiveIds = new Set(['obj-1']);

    const depCheckProtected = checkObjectiveDependencies(plannedObjectives[1], {
      failedObjectiveIds,
      authFailed: true, // Valid auth genuinely failed
      authSucceeded: false,
      credentials: { username: 'standard_user', password: 'secret_sauce' },
      plannedObjectives,
    });

    assert.strictEqual(
      depCheckProtected.canRun,
      false,
      'Protected workflow must be skipped when authentication genuinely fails'
    );
    assert.strictEqual(depCheckProtected.status, 'SKIPPED');
    assert.match(depCheckProtected.reason, /Requires an authenticated session/i);
  });

  // ==========================================================================
  // Test 10: Independent objectives continue after another objective fails
  // ==========================================================================
  it('10. ensures multiple independent test scenarios continue executing even after another scenario fails', () => {
    const plannedObjectives = [
      {
        id: 'obj-1',
        description: 'Test locked-out user login rejection',
        targetBehavior: 'Verify locked_out_user error',
        requiresAuth: false,
        dependsOn: [],
      },
      {
        id: 'obj-2',
        description: 'Test problem-user behavior',
        targetBehavior: 'Verify problem_user flow',
        requiresAuth: false,
        dependsOn: ['obj-1'],
      },
      {
        id: 'obj-3',
        description: 'Test performance-glitch user behavior',
        targetBehavior: 'Verify performance_glitch_user flow',
        requiresAuth: false,
        dependsOn: ['obj-2'],
      },
    ];

    const failedObjectiveIds = new Set(['obj-1']); // obj-1 failed

    const depCheckObj2 = checkObjectiveDependencies(plannedObjectives[1], {
      failedObjectiveIds,
      authFailed: false,
      authSucceeded: false,
      credentials: {},
      plannedObjectives,
    });

    assert.strictEqual(
      depCheckObj2.canRun,
      true,
      'Independent problem-user test must continue after locked-out user test fails'
    );

    // If obj-2 also failed, obj-3 can still run independently
    failedObjectiveIds.add('obj-2');
    const depCheckObj3 = checkObjectiveDependencies(plannedObjectives[2], {
      failedObjectiveIds,
      authFailed: false,
      authSucceeded: false,
      credentials: {},
      plannedObjectives,
    });

    assert.strictEqual(
      depCheckObj3.canRun,
      true,
      'Independent performance-glitch test must continue even after obj-1 and obj-2 failed'
    );
  });
});

