/**
 * Google Gemini Provider for TestIT Autonomous QA Agent.
 * Interacts with Google Generative Language REST API.
 */

export class GeminiProvider {
  constructor(apiKey, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'gemini';
  }

  /**
   * Plans high-level testable objectives from user instructions.
   *
   * @param {object} params
   * @param {string} params.url
   * @param {string} params.instructions
   * @param {object} [params.credentials]
   * @returns {Promise<{ objectives: Array<{ id: string, description: string, targetBehavior: string, expectedOutcome: string, preconditions: string[] }> }>}
   */
  async planObjectives({ url, instructions, credentials = {} }) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const systemInstruction = `You are TestIT AI, an expert autonomous QA testing agent.
Your job is to analyze the user's natural-language website testing instructions and break them down into 1 to 4 concrete, testable objectives.

Requirements:
- Website URL: "${url}"
- Extract testable behaviors (e.g. verify date/weekday sync, test form validation, check search & filters, verify data persistence across reload).
- Define expected outcomes based on reliable criteria.
- Note any prerequisites (such as test credentials or existing data).
- NEVER assume every website has login, search, or cart.
- Return ONLY valid JSON matching this schema:
{
  "objectives": [
    {
      "id": "obj-1",
      "description": "Clear human-readable summary of what to test",
      "targetBehavior": "Specific feature or behavior being exercised",
      "expectedOutcome": "Concrete measurable outcome that proves success",
      "preconditions": ["Optional prerequisites like test credentials"],
      "safetyRestrictions": ["Prohibited actions like actual payment or data deletion"]
    }
  ]
}`;

    const userPrompt = `Target Website: ${url}
User Instructions: "${instructions}"
Test Credentials Available: ${credentials?.username ? 'Yes (Username/Password provided)' : 'None'}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) {
      throw new Error('Gemini API returned an empty response during test objective planning.');
    }

    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) {
      throw new Error('Gemini response did not contain an array of test objectives.');
    }

    return parsed;
  }

  /**
   * Decides the next step in the observe-plan-act-verify agent loop based on fresh page observations.
   *
   * @param {object} params
   * @param {object} params.objective - Current objective
   * @param {object} params.observation - Fresh page snapshot (URL, title, accessible elements, visible text, active states)
   * @param {Array<object>} params.history - History of actions taken and verified results so far
   * @param {object} [params.credentials] - Optional test credentials
   * @param {number} params.stepNumber - Current step index (1-based)
   * @param {number} params.maxSteps - Maximum allowable steps
   * @returns {Promise<object>} Next action decision or conclusion
   */
  async decideNextStep({ objective, observation, history = [], credentials = {}, stepNumber = 1, maxSteps = 15 }) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const systemInstruction = `You are TestIT AI, an autonomous QA browser agent executing an Observe-Plan-Act-Verify loop.
You are inspecting a live website via Playwright. Based on the current page observation and action history, you must either:
1. Choose ONE concrete browser action to advance toward the objective, OR
2. CONCLUDE the test if the objective is fully verified, proven failed, blocked by missing prerequisites, or ambiguous.

Available Actions:
- "click": target { strategy: "role"|"text"|"label"|"placeholder"|"css", value: string, name?: string }
- "fill": target { strategy, value, name }, value: string
- "select": target, value: string
- "pressKey": key: string (e.g. "Enter", "Tab", "Escape")
- "navigate": url: string (must be same origin: "${new URL(observation.url).origin}")
- "refresh": reload the current page to verify data persistence
- "assertVisible": target { strategy, value }
- "assertText": target, value: string, exact?: boolean
- "assertDateSync": verify that the displayed day of the week matches the actual system date
- "conclude": outcome: "PASS"|"FAIL"|"BLOCKED"|"NEEDS_CLARIFICATION", reasoning: string, failureAnalysis?: { description, hypothesis, stepsToReproduce }

Decision Rules:
- Prioritize accessible roles, labels, and text over raw CSS classes.
- If the objective requires verifying date/day synchronization and the page displays a calendar or day ribbon, choose "assertDateSync".
- If the page requires login but no credentials are provided in the environment, conclude with "BLOCKED".
- If an expected error message or validation did not appear when expected, conclude with "FAIL".
- If all verification checks for the objective have succeeded, conclude with "PASS".
- Do NOT repeat the exact same action if it already failed or produced no change.

Return ONLY valid JSON matching this schema:
{
  "thought": "Brief reasoning explaining what you observe and why this step was chosen",
  "action": "click" | "fill" | "select" | "pressKey" | "navigate" | "refresh" | "assertVisible" | "assertText" | "assertDateSync" | "conclude",
  "target": { "strategy": "role|text|label|placeholder|css", "value": "string", "name": "optional name" },
  "value": "string value for fill/select/pressKey",
  "expectedOutcome": "What specific change or element state should be observed after this action",
  "conclude": {
    "outcome": "PASS" | "FAIL" | "BLOCKED" | "NEEDS_CLARIFICATION",
    "reasoning": "Comprehensive explanation of why the objective is met or failed",
    "failureAnalysis": {
      "description": "Concise statement of the issue",
      "stepsToReproduce": ["Step 1", "Step 2"],
      "hypothesis": "Likely underlying cause"
    }
  }
}`;

    // Mask any secrets in credentials
    const safeCreds = {
      hasUsername: Boolean(credentials?.username),
      usernameHint: credentials?.username ? credentials.username.replace(/^(.)(.*)(@.*)$/, '$1***$3') : null,
      hasPassword: Boolean(credentials?.password),
    };

    const promptContext = {
      objective,
      currentStep: stepNumber,
      maxSteps,
      observation: {
        url: observation.url,
        title: observation.title,
        interactiveElements: (observation.interactiveElements || []).slice(0, 30),
        activeControls: observation.activeControls || [],
        headings: (observation.headings || []).slice(0, 10),
        visibleTextSnippet: (observation.visibleTextSnippet || '').slice(0, 1500),
        consoleErrors: observation.consoleErrors || [],
      },
      actionHistory: history.map((h) => ({
        step: h.stepIndex,
        action: h.action,
        description: h.description,
        status: h.status,
        actual: h.actual,
      })),
      credentialsProvided: safeCreds,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstruction}\n\n=== OBSERVED STATE AND GOAL ===\n${JSON.stringify(
                  promptContext,
                  null,
                  2
                )}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API step decision failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Gemini API returned an empty step decision response.');
    }

    return JSON.parse(rawText);
  }
}

