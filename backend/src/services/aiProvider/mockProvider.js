/**
 * Mock AI Provider for deterministic unit testing of the TestIT Agent loop.
 */

export class MockProvider {
  constructor(customSteps = []) {
    this.name = 'mock';
    this.model = 'mock-test-agent';
    this.customSteps = customSteps;
    this.stepIndex = 0;
  }

  setStepSequence(steps) {
    this.customSteps = steps;
    this.stepIndex = 0;
  }

  async planObjectives({ url, instructions }) {
    return {
      objectives: [
        {
          id: 'obj-1',
          description: instructions,
          targetBehavior: 'Autonomous verification of requested flow',
          expectedOutcome: 'Expected outcome verified with evidence',
          preconditions: [],
          safetyRestrictions: [],
        },
      ],
    };
  }

  async decideNextStep({ objective, observation, history = [], stepNumber = 1 }) {
    if (this.customSteps.length > 0 && this.stepIndex < this.customSteps.length) {
      const step = this.customSteps[this.stepIndex++];
      return typeof step === 'function' ? step({ objective, observation, history, stepNumber }) : step;
    }

    // Default heuristic for mock when no custom sequence is provided
    const lower = (objective.description || '').toLowerCase();

    // 1. Date synchronization
    if (lower.includes('date') || lower.includes('day') || lower.includes('calendar') || lower.includes('sync')) {
      if (stepNumber === 1) {
        return {
          thought: 'Inspect date and weekday synchronization on page',
          action: 'assertDateSync',
          expectedOutcome: 'Displayed weekday matches current date',
        };
      }
      return {
        thought: 'Date and weekday synchronization verified',
        action: 'conclude',
        conclude: {
          outcome: 'PASS',
          reasoning: 'Active day and date verified to be synchronized with reference clock.',
        },
      };
    }

    // 2. Generic content verification
    if (stepNumber === 1) {
      return {
        thought: 'Verify page main structure is visible',
        action: 'assertVisible',
        target: { strategy: 'css', value: 'body, main, header' },
        expectedOutcome: 'Page interface rendered and accessible',
      };
    }

    return {
      thought: 'Objective verified successfully',
      action: 'conclude',
      conclude: {
        outcome: 'PASS',
        reasoning: 'Objective completed and verified.',
      },
    };
  }
}

