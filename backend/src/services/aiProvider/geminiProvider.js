/**
 * Google Gemini Provider for TestIT Autonomous QA Agent.
 * Interacts with Google Generative Language REST API.
 */

import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

import {
  ProviderError,
  createProviderHttpError,
  wrapProviderError,
  redactSecrets,
} from './providerSanitizer.js';

export class GeminiProvider {
  constructor(apiKey, model = 'gemini-3.5-flash-lite', options = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = 'gemini';
    this.timeoutMs =
      options.timeoutMs ||
      (process.env.AI_PROVIDER_TIMEOUT_MS ? parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) : 30000);
    this.maxPlanningTokens = options.maxPlanningTokens || 1024;
    this.maxStepTokens = options.maxStepTokens || 800;
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
    // Authenticate via standard x-goog-api-key request header to avoid embedding secret in URL
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const systemInstruction = `You are TestIT AI, an expert autonomous QA testing agent.
Your job is to analyze the user's natural-language website testing instructions and break them down into 1 to 4 concrete, testable objectives.

Requirements:
- Website URL: "${url}"
- Extract testable behaviors (e.g. verify date/weekday sync, test form validation, check search & filters, verify data persistence across reload).
- Define expected outcomes based on reliable criteria.
- Note any prerequisites (such as test credentials or existing data).
- NEVER assume every website has login, search, or cart.
- Authentication & Dependency Rules:
  1. A login-verification objective tests the authentication mechanism itself (targetBehavior: "Verify login functionality"). A login-testing objective does NOT require an already authenticated session (requiresAuth: false).
  2. If testing invalid login, use deliberately invalid credentials (e.g., "invalid_user", "wrong_password") to verify that access is denied.
  3. Valid login testing requires provided test credentials.
  4. When testing BOTH valid and invalid login, test invalid login first (to verify denial), then log in with valid credentials so the session remains in a valid authenticated state for subsequent objectives.
  5. Independent authentication tests: Testing invalid login, locked-out user, problem-user, or performance-glitch user are independent authentication tests. Do NOT make them depend on each other (leave "dependsOn": []).
  6. Public features (such as landing page inspection, public search, product browsing, or footer links) do NOT require an authenticated session and must NOT list login in "dependsOn": [].
  7. If subsequent objectives genuinely require an authenticated session (e.g. private profile, cart checkout, restricted order history), set "requiresAuth": true and specify "dependsOn": ["<valid-login-objective-id>"].
  8. ONLY specify "dependsOn" when an objective genuinely requires the specific output or authenticated state of a prior objective.
- Return ONLY valid JSON matching this schema:
{
  "objectives": [
    {
      "id": "obj-1",
      "description": "Clear human-readable summary of what to test",
      "targetBehavior": "Specific feature or behavior being exercised",
      "expectedOutcome": "Concrete measurable outcome that proves success",
      "preconditions": ["Optional prerequisites like test credentials or page state"],
      "dependsOn": ["Optional list of prerequisite objective IDs"],
      "requiresAuth": false,
      "safetyRestrictions": ["Prohibited actions like actual payment or data deletion"]
    }
  ]
}`;

    const userPrompt = `Target Website: ${url}
User Instructions: "${instructions}"
Test Credentials Available: ${credentials?.username ? 'Yes (Username/Password provided)' : 'None'}`;

    const planPayload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: this.maxPlanningTokens,
        },
      }),
    };

    try {
      const candidateModels = [this.model, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(
        (m, idx, arr) => m && arr.indexOf(m) === idx
      );

    let lastHttpError = null;

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const activeModel = candidateModels[mIdx];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`;

      let response;
      const maxRetries = 2;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(endpoint, {
            ...planPayload,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (firstErr) {
          if (attempt === maxRetries) throw firstErr;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          const retryAfterSec = parseInt(response.headers?.get?.('retry-after') || '0', 10);
          const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1500 * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }

      if (response && response.ok) {
        if (activeModel !== this.model) {
          console.log(`[Gemini Failover]: Switched to operational model "${activeModel}" after "${this.model}" returned unavailable.`);
          this.model = activeModel;
        }

        const data = await response.json().catch(() => {
          throw new ProviderError('Gemini API returned an unparseable response payload.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        });

        const candidate = data?.candidates?.[0];
        if (!candidate) {
          throw new ProviderError('Gemini API returned no candidates in response.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        if (candidate.finishReason === 'MAX_TOKENS') {
          throw new ProviderError(
            'Gemini output was truncated due to output token limits (finishReason: MAX_TOKENS).',
            {
              providerName: 'Gemini',
              category: 'malformed_response',
            }
          );
        }

        const rawJson = candidate?.content?.parts?.[0]?.text;
        if (!rawJson || !rawJson.trim()) {
          throw new ProviderError('Gemini API returned an empty response during test objective planning.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        let parsed;
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          throw new ProviderError('Gemini response could not be parsed as valid JSON.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) {
          throw new ProviderError('Gemini response did not contain an array of test objectives.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        return parsed;
      }

      const errText = await response.text().catch(() => '');
      lastHttpError = createProviderHttpError({
        providerName: 'Gemini',
        status: response.status,
        rawBody: errText,
        apiKey: this.apiKey,
      });

      if ((response.status === 503 || response.status === 404) && mIdx < candidateModels.length - 1) {
        console.log(`[Gemini Provider]: Model "${activeModel}" returned HTTP ${response.status}. Trying fallback model "${candidateModels[mIdx + 1]}".`);
        continue;
      }

      throw lastHttpError;
    }

    if (lastHttpError) throw lastHttpError;
  } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw wrapProviderError(err, {
        providerName: 'Gemini',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      });
    }
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
   * @param {number} [params.maxSteps=25] - Maximum allowable steps
   * @returns {Promise<object>} Next action decision or conclusion
   */
  async decideNextStep({
    objective,
    observation,
    history = [],
    credentials = {},
    stepNumber = 1,
    maxSteps = 25,
  }) {
    // Authenticate via standard x-goog-api-key request header to avoid embedding secret in URL
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

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

Canonical Target Strategy Rules:
- Target "strategy" MUST be one of ONLY 5 supported values: "role", "label", "placeholder", "text", "css".
- CRITICAL: Strategies such as "name", "id", "xpath", or "class" are NOT supported and will trigger schema validation errors.
- To target an element by HTML name attribute, ID, or class, use strategy "css" with a standard CSS attribute selector (e.g. {"strategy": "css", "value": "[name=\"user-name\"]"} or {"strategy": "css", "value": "#user-name"}).

Decision Rules:
- Prioritize accessible roles, labels, and text over raw CSS classes.
- Generic & Prompt-Driven: The user's plain-English instruction dictates what to test. NEVER assume a website follows a specific pre-baked workflow or structure.
- Ambiguous Controls: If multiple identical controls exist for an action (e.g. multiple "Select", "Delete", or "Add" buttons), compare surrounding cards, rows, or labels. If ambiguity remains without distinguishing context, conclude with "BLOCKED" or "NEEDS_CLARIFICATION". NEVER guess an arbitrary candidate.
- Real Application State Verification: A button click, modal popup, or toast notification alone does NOT establish PASS. Verify the persistent underlying state (e.g. item present in table, cart count updated, database record listed). If a success toast appears but the list/table/cart remains empty, conclude with "FAIL".
- Dead Clicks / No-Ops: If an interaction produces no observable DOM mutation, URL change, or status update, do NOT conclude PASS.
- Empty Results: If a query or search returns "No results found" or 0 items when expecting items, conclude with "FAIL".
- Observation-Driven Verification: A click or action dispatch alone NEVER establishes PASS. After executing an interaction (e.g. click submit, select option, apply filter, add item, book), you MUST observe the resulting page state and verify that the expected outcome occurred (using "assertVisible", "assertText", or citing specific verified content/evidence in the page snippet) before concluding PASS.
- If the expected outcome or evidence is not observed on the page after performing an action, conclude with "FAIL" stating what was expected vs what was observed.
- Adaptive Recovery: If a prior action in history failed with an error, inspect the fresh page observation and try an alternative locator strategy or action rather than repeating the failed action.
- If the objective requires verifying date/day synchronization and the page displays a calendar or day ribbon, choose "assertDateSync".
- If testing invalid login: Fill username and password with deliberately invalid values (e.g., "invalid_user", "wrong_password"), submit, and verify that access is denied (error message, alert, or remaining on login page).
- When testing valid login: Identify the username/email and password fields to fill. You do not possess the user's secret credentials. For the username/email field, set value to "[VALID_USERNAME]" (or leave blank ""). For the password field, set value to "[VALID_PASSWORD]" (or leave blank ""). The test runner injects the exact user-provided credentials directly into the browser. Never generate or rewrite user-provided credentials.
- When testing both valid and invalid login: First test invalid credentials and verify denial, then submit valid credentials to establish the authenticated session.
- If the current objective requires an authenticated session and the page is currently unauthenticated or on a login page, perform login using the available valid credentials to establish the authenticated session before proceeding with the objective.
- If a page requires login but no credentials are provided in the environment, conclude with "BLOCKED".
- If all verification checks for the objective have succeeded with observed browser evidence, conclude with "PASS".
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

    // Indicate credential availability only; never expose credential text, fragments, or hints in prompts
    const safeCreds = {
      hasUsername: Boolean(credentials?.username),
      hasPassword: Boolean(credentials?.password),
    };

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
        description: redactSecrets(h.description, secretsToRedact),
        status: h.status,
        actual: redactSecrets(h.actual, secretsToRedact),
      })),
      credentialsProvided: safeCreds,
    };

    const fetchPayload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
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
          maxOutputTokens: this.maxStepTokens,
        },
      }),
    };

    try {
      const candidateModels = [this.model, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(
        (m, idx, arr) => m && arr.indexOf(m) === idx
      );

    let lastHttpError = null;

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const activeModel = candidateModels[mIdx];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`;

      let response;
      const maxRetries = 2;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(endpoint, {
            ...fetchPayload,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (firstErr) {
          if (attempt === maxRetries) throw firstErr;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          const retryAfterSec = parseInt(response.headers?.get?.('retry-after') || '0', 10);
          const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1500 * attempt;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }

      if (response && response.ok) {
        if (activeModel !== this.model) {
          console.log(`[Gemini Failover]: Switched to operational model "${activeModel}" after "${this.model}" returned unavailable.`);
          this.model = activeModel;
        }

        const data = await response.json().catch(() => {
          throw new ProviderError('Gemini API returned an unparseable response payload.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        });

        const candidate = data?.candidates?.[0];
        if (!candidate) {
          throw new ProviderError('Gemini API returned no candidates in response.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        if (candidate.finishReason === 'MAX_TOKENS') {
          throw new ProviderError(
            'Gemini output was truncated due to output token limits (finishReason: MAX_TOKENS).',
            {
              providerName: 'Gemini',
              category: 'malformed_response',
            }
          );
        }

        const rawText = candidate?.content?.parts?.[0]?.text;
        if (!rawText || !rawText.trim()) {
          throw new ProviderError('Gemini API returned an empty step decision response.', {
            providerName: 'Gemini',
            category: 'malformed_response',
          });
        }

        try {
          return JSON.parse(rawText);
        } catch {
          const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          try {
            return JSON.parse(cleaned);
          } catch (jsonErr) {
            throw new ProviderError(`Gemini step decision response could not be parsed as valid JSON: ${jsonErr.message}`, {
              providerName: 'Gemini',
              category: 'malformed_response',
            });
          }
        }
      }

      const errText = await response.text().catch(() => '');
      lastHttpError = createProviderHttpError({
        providerName: 'Gemini',
        status: response.status,
        rawBody: errText,
        apiKey: this.apiKey,
      });

      if ((response.status === 503 || response.status === 404) && mIdx < candidateModels.length - 1) {
        console.log(`[Gemini Provider]: Model "${activeModel}" returned HTTP ${response.status}. Trying fallback model "${candidateModels[mIdx + 1]}".`);
        continue;
      }

      throw lastHttpError;
    }

    if (lastHttpError) throw lastHttpError;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw wrapProviderError(err, {
        providerName: 'Gemini',
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      });
    }
  }
}
