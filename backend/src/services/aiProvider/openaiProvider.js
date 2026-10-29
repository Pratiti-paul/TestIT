/**
 * OpenAI Provider for TestIT Autonomous QA Agent.
 * Interacts with OpenAI Chat Completions API.
 */

export class OpenAiProvider {
  constructor(apiKey, model = 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'openai';
  }

  async planObjectives({ url, instructions, credentials = {} }) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `You are TestIT AI, an expert autonomous QA testing agent.
Analyze user natural-language testing instructions for a hosted website and output 1 to 4 concrete testable objectives.
Return JSON matching { "objectives": [ { "id": "obj-1", "description": string, "targetBehavior": string, "expectedOutcome": string, "preconditions": string[], "safetyRestrictions": string[] } ] }`;

    const userPrompt = `Website: ${url}\nInstructions: "${instructions}"\nCredentials: ${
      credentials?.username ? 'Available' : 'None'
    }`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) {
      throw new Error('OpenAI response did not contain an array of test objectives.');
    }

    return parsed;
  }

  async decideNextStep({ objective, observation, history = [], credentials = {}, stepNumber = 1, maxSteps = 15 }) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `You are TestIT AI, an autonomous QA agent executing an Observe-Plan-Act-Verify loop.
Based on the live page observation and action history, select the next single Playwright action or conclude.
Return JSON with:
{
  "thought": string,
  "action": "click"|"fill"|"select"|"pressKey"|"navigate"|"refresh"|"assertVisible"|"assertText"|"assertDateSync"|"conclude",
  "target": { "strategy": "role"|"text"|"label"|"placeholder"|"css", "value": string, "name"?: string },
  "value"?: string,
  "expectedOutcome": string,
  "conclude"?: { "outcome": "PASS"|"FAIL"|"BLOCKED"|"NEEDS_CLARIFICATION", "reasoning": string, "failureAnalysis"?: { "description": string, "stepsToReproduce": string[], "hypothesis": string } }
}`;

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
        status: h.status,
        actual: h.actual,
      })),
      hasCredentials: Boolean(credentials?.username),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: JSON.stringify(promptContext) },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API step decision failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return JSON.parse(content);
  }
}

