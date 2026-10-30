import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiProvider,
  OpenAiProvider,
  ProviderError,
  redactSecrets,
  getActiveAiProvider,
} from '../src/services/aiProvider/index.js';
import { executeAiAgent } from '../src/services/aiAgentService.js';

describe('AI Provider Request Security, Reliability & Sanitization Suite', () => {
  const SYNTHETIC_SECRET = 'TEST_SECRET_DO_NOT_LEAK_AIzaSyFake123456';
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Gemini API Credential Protection', () => {
    it('sends credentials via x-goog-api-key request header without embedding the API key in the URL', async () => {
      let interceptedUrl = null;
      let interceptedHeaders = null;
      let interceptedBody = null;

      globalThis.fetch = async (url, options) => {
        interceptedUrl = url;
        interceptedHeaders = options.headers;
        interceptedBody = JSON.parse(options.body);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        objectives: [
                          {
                            id: 'obj-1',
                            description: 'Verify page loads',
                            targetBehavior: 'Page rendering',
                            expectedOutcome: 'Page is visible',
                            preconditions: [],
                            safetyRestrictions: [],
                          },
                        ],
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        };
      };

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      const plan = await provider.planObjectives({
        url: 'https://example.com',
        instructions: 'Test landing page',
      });

      // 1. URL must strictly not contain the secret or key query parameter
      assert.ok(!interceptedUrl.includes(SYNTHETIC_SECRET), 'URL must not contain the API key');
      assert.ok(!interceptedUrl.includes('key='), 'URL must not contain key query parameter');
      assert.equal(
        interceptedUrl,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
      );

      // 2. Secret must be passed via standard x-goog-api-key header
      assert.equal(
        interceptedHeaders['x-goog-api-key'],
        SYNTHETIC_SECRET,
        'Secret must be sent via x-goog-api-key header'
      );

      // 3. Plan must be parsed properly
      assert.equal(plan.objectives.length, 1);
      assert.equal(plan.objectives[0].id, 'obj-1');
      assert.ok(interceptedBody.generationConfig);
    });

    it('ensures decideNextStep sends credentials via x-goog-api-key header without URL query string', async () => {
      let interceptedUrl = null;
      let interceptedHeaders = null;

      globalThis.fetch = async (url, options) => {
        interceptedUrl = url;
        interceptedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        thought: 'Conclude test successfully',
                        action: 'conclude',
                        conclude: { outcome: 'PASS', reasoning: 'All verified' },
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        };
      };

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      const decision = await provider.decideNextStep({
        objective: { id: 'obj-1', description: 'Test' },
        observation: { url: 'https://example.com', title: 'Example' },
      });

      assert.ok(!interceptedUrl.includes(SYNTHETIC_SECRET));
      assert.ok(!interceptedUrl.includes('?key='));
      assert.equal(interceptedHeaders['x-goog-api-key'], SYNTHETIC_SECRET);
      assert.equal(decision.action, 'conclude');
    });
  });

  describe('2. Bounded Provider Request Timeouts', () => {
    it('Gemini provider attaches AbortSignal timeout and handles cancellation gracefully', async () => {
      let interceptedSignal = null;

      globalThis.fetch = async (url, options) => {
        interceptedSignal = options.signal;
        const timeoutError = new Error('The operation was aborted due to timeout');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      };

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash', { timeoutMs: 5000 });

      await assert.rejects(
        async () => {
          await provider.planObjectives({
            url: 'https://example.com',
            instructions: 'Verify navigation',
          });
        },
        (err) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.category, 'timeout');
          assert.match(err.message, /timed out after 5000ms/i);
          assert.ok(!err.message.includes(SYNTHETIC_SECRET));
          return true;
        }
      );

      assert.ok(interceptedSignal, 'fetch must receive an AbortSignal');
    });

    it('OpenAI provider attaches AbortSignal timeout and converts timeout to structured error', async () => {
      let interceptedSignal = null;

      globalThis.fetch = async (url, options) => {
        interceptedSignal = options.signal;
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      };

      const provider = new OpenAiProvider(SYNTHETIC_SECRET, 'gpt-4o-mini', { timeoutMs: 8000 });

      await assert.rejects(
        async () => {
          await provider.decideNextStep({
            objective: { id: 'obj-1' },
            observation: { url: 'https://example.com' },
          });
        },
        (err) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.category, 'timeout');
          assert.match(err.message, /timed out after 8000ms/i);
          assert.ok(!err.message.includes(SYNTHETIC_SECRET));
          return true;
        }
      );

      assert.ok(interceptedSignal, 'fetch must receive an AbortSignal');
    });
  });

  describe('3. Bounded Model Output Token Limits', () => {
    it('configures conservative maxOutputTokens in Gemini planning and step decisions', async () => {
      const bodies = [];

      globalThis.fetch = async (url, options) => {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        objectives: [
                          {
                            id: 'obj-1',
                            description: 'Sample',
                            targetBehavior: 'Check',
                            expectedOutcome: 'Done',
                          },
                        ],
                        thought: 'Conclude',
                        action: 'conclude',
                        conclude: { outcome: 'PASS', reasoning: 'Done' },
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        };
      };

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash', {
        maxPlanningTokens: 1024,
        maxStepTokens: 800,
      });

      await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
      assert.equal(bodies[0].generationConfig.maxOutputTokens, 1024);

      await provider.decideNextStep({
        objective: { id: 'obj-1' },
        observation: { url: 'https://example.com' },
      });
      assert.equal(bodies[1].generationConfig.maxOutputTokens, 800);
    });

    it('configures conservative max_tokens in OpenAI planning and step decisions', async () => {
      const bodies = [];

      globalThis.fetch = async (url, options) => {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    objectives: [
                      {
                        id: 'obj-1',
                        description: 'Sample',
                        targetBehavior: 'Check',
                        expectedOutcome: 'Done',
                      },
                    ],
                    thought: 'Conclude',
                    action: 'conclude',
                    conclude: { outcome: 'PASS', reasoning: 'Done' },
                  }),
                },
                finish_reason: 'stop',
              },
            ],
          }),
        };
      };

      const provider = new OpenAiProvider(SYNTHETIC_SECRET, 'gpt-4o-mini', {
        maxPlanningTokens: 1024,
        maxStepTokens: 800,
      });

      await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
      assert.equal(bodies[0].max_tokens, 1024);

      await provider.decideNextStep({
        objective: { id: 'obj-1' },
        observation: { url: 'https://example.com' },
      });
      assert.equal(bodies[1].max_tokens, 800);
    });

    it('rejects truncated Gemini output when finishReason is MAX_TOKENS', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: '{"objectives": [{"id": "obj-1"' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }),
      });

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      await assert.rejects(
        async () => {
          await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
        },
        (err) => {
          assert.equal(err.category, 'malformed_response');
          assert.match(err.message, /truncated/i);
          return true;
        }
      );
    });

    it('rejects truncated OpenAI output when finish_reason is length', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '{"thought": "Doing something...' },
              finish_reason: 'length',
            },
          ],
        }),
      });

      const provider = new OpenAiProvider(SYNTHETIC_SECRET, 'gpt-4o-mini');
      await assert.rejects(
        async () => {
          await provider.decideNextStep({
            objective: { id: 'obj-1' },
            observation: { url: 'https://example.com' },
          });
        },
        (err) => {
          assert.equal(err.category, 'malformed_response');
          assert.match(err.message, /truncated/i);
          return true;
        }
      );
    });

    it('rejects malformed non-JSON syntax and missing array structure explicitly', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: 'This is not valid JSON at all' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      });

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      await assert.rejects(
        async () => {
          await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
        },
        (err) => {
          assert.equal(err.category, 'malformed_response');
          assert.match(err.message, /valid JSON/i);
          return true;
        }
      );

      // Missing array
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ wrongField: 'no objectives here' }) },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const openAiProvider = new OpenAiProvider(SYNTHETIC_SECRET, 'gpt-4o-mini');
      await assert.rejects(
        async () => {
          await openAiProvider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
        },
        (err) => {
          assert.equal(err.category, 'malformed_response');
          assert.match(err.message, /array of test objectives/i);
          return true;
        }
      );
    });
  });

  describe('4. Error Sanitization & Safe Classification', () => {
    it('classifies HTTP 401 and 403 as authentication_error and scrubs secrets', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => `Invalid key provided: ${SYNTHETIC_SECRET}. Access denied.`,
      });

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      await assert.rejects(
        async () => {
          await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
        },
        (err) => {
          assert.equal(err.category, 'authentication_error');
          assert.match(err.message, /authentication failed/i);
          assert.ok(!err.message.includes(SYNTHETIC_SECRET), 'Error message must not leak secret');
          return true;
        }
      );
    });

    it('classifies HTTP 429 as rate_limit_error', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Resource has been exhausted (e.g. check quota).',
      });

      const provider = new OpenAiProvider(SYNTHETIC_SECRET, 'gpt-4o-mini');
      await assert.rejects(
        async () => {
          await provider.planObjectives({ url: 'https://example.com', instructions: 'Test' });
        },
        (err) => {
          assert.equal(err.category, 'rate_limit_error');
          assert.match(err.message, /rate limit or quota exceeded/i);
          return true;
        }
      );
    });

    it('classifies HTTP 500/503 as service_error', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        text: async () => 'Service Temporarily Unavailable',
      });

      const provider = new GeminiProvider(SYNTHETIC_SECRET, 'gemini-2.5-flash');
      await assert.rejects(
        async () => {
          await provider.decideNextStep({
            objective: { id: 'obj-1' },
            observation: { url: 'https://example.com' },
          });
        },
        (err) => {
          assert.equal(err.category, 'service_error');
          assert.match(err.message, /service error/i);
          return true;
        }
      );
    });

    it('redacts query parameter keys, Bearer tokens, and auth headers from arbitrary error strings', () => {
      const dirty1 = `Error at https://example.com/api?key=${SYNTHETIC_SECRET}&other=value`;
      const clean1 = redactSecrets(dirty1, [SYNTHETIC_SECRET]);
      assert.ok(!clean1.includes(SYNTHETIC_SECRET));
      assert.ok(clean1.includes('key=[REDACTED]'));

      const dirty2 = `Authorization failed for Bearer ${SYNTHETIC_SECRET}`;
      const clean2 = redactSecrets(dirty2, [SYNTHETIC_SECRET]);
      assert.ok(!clean2.includes(SYNTHETIC_SECRET));
      assert.ok(clean2.includes('Bearer [REDACTED]'));

      const dirty3 = `Failed header: x-goog-api-key: ${SYNTHETIC_SECRET}`;
      const clean3 = redactSecrets(dirty3, [SYNTHETIC_SECRET]);
      assert.ok(!clean3.includes(SYNTHETIC_SECRET));
      assert.ok(clean3.includes('x-goog-api-key: [REDACTED]'));
    });
  });

  describe('5. Agent Loop Failure Reporting & Non-Conversion to PASS', () => {
    it('agent loop marks planning failure as status: error, records errorSteps: 1, and never PASS', async () => {
      // Mock global fetch to return an authentication error containing synthetic secret
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => `Unauthorized request with Bearer ${SYNTHETIC_SECRET}`,
      });

      // Temporarily set process.env for provider discovery
      const originalEnv = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = SYNTHETIC_SECRET;

      try {
        const report = await executeAiAgent(
          {
            url: 'http://127.0.0.1:49999',
            instructions: 'Verify contact form',
          },
          {
            allowLocalForTesting: true,
          }
        );

        // Verify status is strictly 'error' and not 'passed'
        assert.equal(report.status, 'error');
        assert.equal(report.passedSteps, 0);
        assert.equal(report.errorSteps, 1);
        assert.equal(report.planner.aiConfigured, true);

        // Verify report stringified JSON contains zero traces of the synthetic secret
        const reportJson = JSON.stringify(report);
        assert.ok(
          !reportJson.includes(SYNTHETIC_SECRET),
          'Report JSON must not contain synthetic secret'
        );
        assert.ok(
          !reportJson.includes('key=' + SYNTHETIC_SECRET),
          'Report must not contain secret query parameter'
        );

        // Verify structured diagnostic hypothesis
        assert.match(report.failure.hypothesis, /API key is valid/i);
      } finally {
        if (originalEnv) {
          process.env.GEMINI_API_KEY = originalEnv;
        } else {
          delete process.env.GEMINI_API_KEY;
        }
      }
    });

    it('agent loop handles rate limit error during planning safely', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Quota exhausted for project',
      });

      const originalEnv = process.env.OPENAI_API_KEY;
      const originalGemini = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = SYNTHETIC_SECRET;

      try {
        const report = await executeAiAgent(
          {
            url: 'http://127.0.0.1:49999',
            instructions: 'Verify payment gateway',
          },
          {
            allowLocalForTesting: true,
          }
        );

        assert.equal(report.status, 'error');
        assert.match(report.failure.hypothesis, /quota/i);
        assert.ok(!JSON.stringify(report).includes(SYNTHETIC_SECRET));
      } finally {
        if (originalEnv) process.env.OPENAI_API_KEY = originalEnv;
        else delete process.env.OPENAI_API_KEY;
        if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
      }
    });

    it('preserves existing mock-provider behavior and resolution via getActiveAiProvider', async () => {
      const mockSteps = [
        {
          thought: 'Inspect date and weekday synchronization on page',
          action: 'assertDateSync',
          expectedOutcome: 'Displayed weekday matches current date',
        },
        {
          thought: 'Date and weekday synchronization verified',
          action: 'conclude',
          conclude: {
            outcome: 'PASS',
            reasoning: 'Active day and date verified to be synchronized with reference clock.',
          },
        },
      ];

      const provider = getActiveAiProvider({ allowMock: true, mockSteps });
      assert.ok(provider);
      assert.equal(provider.name, 'mock');
      assert.equal(provider.model, 'mock-test-agent');

      const plan = await provider.planObjectives({
        url: 'https://example.com',
        instructions: 'Check date and weekday sync',
      });
      assert.equal(Array.isArray(plan.objectives), true);
      assert.equal(plan.objectives.length, 1);

      const decision = await provider.decideNextStep({
        objective: plan.objectives[0],
        observation: { url: 'https://example.com' },
        stepNumber: 1,
      });
      assert.equal(decision.action, 'assertDateSync');
    });
  });
});
