/**
 * OpenAI Provider for TestIT Autonomous QA Agent.
 * Interacts with OpenAI Chat Completions API.
 */

import {
  ProviderError,
  createProviderHttpError,
  wrapProviderError,
  redactSecrets,
} from './providerSanitizer.js';

export class OpenAiProvider {
  constructor(apiKey, model = 'gpt-4o-mini', options = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'openai';
    this.timeoutMs =
      options.timeoutMs ||
      (process.env.AI_PROVIDER_TIMEOUT_MS ? parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) : 15000);
    this.maxPlanningTokens = options.maxPlanningTokens || 1024;
    this.maxStepTokens = options.maxStepTokens || 800;
  }

  async planObjectives({ url, instructions, credentials = {} }) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `You are TestIT AI, an expert autonomous QA testing agent.
Analyze user natural-language testing instructions for a hosted website and output 1 to 4 concrete testable objectives.
Requirements:
- A login-verification objective tests the authentication mechanism itself (requiresAuth: false).
- If testing invalid login, use deliberately invalid credentials (e.g. "invalid_user", "wrong_password") to verify access rejection.
- Valid login testing requires provided test credentials.
- When testing both valid and invalid login, test invalid login first, then valid login to establish an authenticated session.
- Only mark requiresAuth: true if an objective strictly requires an active, authenticated session (e.g. private profile).
- Return JSON matching { "objectives": [ { "id": "obj-1", "description": string, "targetBehavior": string, "expectedOutcome": string, "preconditions": string[], "dependsOn"?: string[], "requiresAuth"?: boolean, "safetyRestrictions": string[] } ] }`;

    const userPrompt = `Website: ${url}\nInstructions: "${instructions}"\nCredentials: ${
      credentials?.username ? 'Available' : 'None'
    }`;

    try {
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
          max_tokens: this.maxPlanningTokens,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw createProviderHttpError({
          providerName: 'OpenAI',
          status: response.status,
          rawBody: errText,
          apiKey: this.apiKey,
        });
      }

      const data = await response.json().catch(() => {
        throw new ProviderError('OpenAI API returned an unparseable response payload.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      });

      const choice = data?.choices?.[0];
      if (!choice) {
        throw new ProviderError('OpenAI API returned no choices in response.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      if (choice.finish_reason === 'length') {
        throw new ProviderError(
          'OpenAI output was truncated due to output token limits (finish_reason: length).',
          {
            providerName: 'OpenAI',
            category: 'malformed_response',
          }
        );
      }

      const content = choice?.message?.content;
      if (!content || !content.trim()) {
        throw new ProviderError('OpenAI API returned an empty response during test objective planning.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ProviderError('OpenAI response could not be parsed as valid JSON.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) {
        throw new ProviderError('OpenAI response did not contain an array of test objectives.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      return parsed;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw wrapProviderError(err, {
        providerName: 'OpenAI',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      });
    }
  }

  async decideNextStep({
    objective,
    observation,
    history = [],
    credentials = {},
    stepNumber = 1,
    maxSteps = 25,
  }) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `You are TestIT AI, an autonomous QA agent executing an Observe-Plan-Act-Verify loop.
Based on the live page observation and action history, select the next single Playwright action or conclude.
Rules:
- For invalid login testing: Fill deliberately invalid credentials (e.g. "invalid_user", "wrong_password"), submit, and verify access rejection.
- For valid login testing: Identify the username/email and password fields to fill. You do not possess the user's secret credentials. For the username/email field, set value to "[VALID_USERNAME]" (or empty string ""). For the password field, set value to "[VALID_PASSWORD]" (or empty string ""). The execution runner injects the exact user-provided credentials directly into the browser. Never generate or rewrite user-provided credentials.
- If testing both valid and invalid login: Test invalid credentials first, then valid credentials to leave the session authenticated.
- If the current objective requires an authenticated session and the page is on a login form, log in with valid credentials first.
- If credentials are required but none provided, conclude BLOCKED.
Return JSON with:
{
  "thought": string,
  "action": "click"|"fill"|"select"|"pressKey"|"navigate"|"refresh"|"assertVisible"|"assertText"|"assertDateSync"|"conclude",
  "target": { "strategy": "role"|"text"|"label"|"placeholder"|"css", "value": string, "name"?: string },
  "value"?: string,
  "expectedOutcome": string,
  "conclude"?: { "outcome": "PASS"|"FAIL"|"BLOCKED"|"NEEDS_CLARIFICATION", "reasoning": string, "failureAnalysis"?: { "description": string, "stepsToReproduce": string[], "hypothesis": string } }
}`;

    const secretsToRedact = [credentials?.password, credentials?.username].filter(Boolean);

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
        visibleTextSnippet: redactSecrets((observation.visibleTextSnippet || '').slice(0, 1500), secretsToRedact),
        consoleErrors: observation.consoleErrors || [],
      },
      actionHistory: history.map((h) => ({
        step: h.stepIndex,
        action: h.action,
        status: h.status,
        actual: redactSecrets(h.actual, secretsToRedact),
      })),
      hasCredentials: Boolean(credentials?.username),
    };

    try {
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
          max_tokens: this.maxStepTokens,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: JSON.stringify(promptContext) },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw createProviderHttpError({
          providerName: 'OpenAI',
          status: response.status,
          rawBody: errText,
          apiKey: this.apiKey,
        });
      }

      const data = await response.json().catch(() => {
        throw new ProviderError('OpenAI API returned an unparseable response payload.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      });

      const choice = data?.choices?.[0];
      if (!choice) {
        throw new ProviderError('OpenAI API returned no choices in response.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      if (choice.finish_reason === 'length') {
        throw new ProviderError(
          'OpenAI output was truncated due to output token limits (finish_reason: length).',
          {
            providerName: 'OpenAI',
            category: 'malformed_response',
          }
        );
      }

      const content = choice?.message?.content;
      if (!content || !content.trim()) {
        throw new ProviderError('OpenAI API returned an empty step decision response.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }

      try {
        return JSON.parse(content);
      } catch {
        throw new ProviderError('OpenAI step decision response could not be parsed as valid JSON.', {
          providerName: 'OpenAI',
          category: 'malformed_response',
        });
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw wrapProviderError(err, {
        providerName: 'OpenAI',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      });
    }
  }
}
