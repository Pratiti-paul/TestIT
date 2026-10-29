/**
 * Mock AI Provider for deterministic unit testing of the TestIT Agent loop.
 */

export class MockProvider {
  constructor(customSteps = [], customObjectives = null) {
    this.name = 'mock';
    this.model = 'mock-test-agent';
    this.customSteps = customSteps;
    this.customObjectives = customObjectives;
    this.stepIndex = 0;
  }

  setStepSequence(steps) {
    this.customSteps = steps;
    this.stepIndex = 0;
  }

  setObjectives(objectives) {
    this.customObjectives = objectives;
  }

  async planObjectives({ url, instructions }) {
    if (Array.isArray(this.customObjectives) && this.customObjectives.length > 0) {
      return { objectives: this.customObjectives };
    }

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

  async decideNextStep({ objective, observation, history = [], stepNumber = 1, maxSteps = 15 }) {
    if (typeof this.customSteps === 'function') {
      const step = this.customSteps({ objective, observation, history, stepNumber, maxSteps });
      if (step) return step;
    }

    if (Array.isArray(this.customSteps) && this.customSteps.length > 0 && this.stepIndex < this.customSteps.length) {
      const step = this.customSteps[this.stepIndex++];
      const resolved = typeof step === 'function' ? step({ objective, observation, history, stepNumber, maxSteps }) : step;
      if (resolved) return resolved;
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

