import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateClientUrl } from '../src/utils/urlHelpers.js';
import {
  runWebsiteScan,
  getFunctionalTestSchema,
  validateFunctionalTest,
  executeFunctionalTest,
  executeAiTest,
} from '../src/services/api.js';

describe('Frontend UI Logic & Utilities', () => {
  describe('validateClientUrl', () => {
    it('rejects empty, null, or whitespace URL', () => {
      const empty = validateClientUrl('');
      assert.equal(empty.isValid, false);
      assert.match(empty.error, /enter a website URL/i);

      const nullVal = validateClientUrl(null);
      assert.equal(nullVal.isValid, false);

      const spaces = validateClientUrl('   ');
      assert.equal(spaces.isValid, false);
    });

    it('rejects URLs without http or https protocol', () => {
      const ftp = validateClientUrl('ftp://example.com');
      assert.equal(ftp.isValid, false);
      assert.match(ftp.error, /http:\/\/ or https:\/\//i);

      const rawDomain = validateClientUrl('example.com');
      assert.equal(rawDomain.isValid, false);
      assert.match(rawDomain.error, /http:\/\/ or https:\/\//i);

      const fileProto = validateClientUrl('file:///etc/passwd');
      assert.equal(fileProto.isValid, false);
    });

    it('accepts legitimate public HTTP and HTTPS URLs', () => {
      const https = validateClientUrl('https://example.com');
      assert.equal(https.isValid, true);
      assert.equal(https.url, 'https://example.com');

      const httpUrl = validateClientUrl('http://test.org/path?query=value#hash');
      assert.equal(httpUrl.isValid, true);
      assert.equal(httpUrl.url, 'http://test.org/path?query=value#hash');
    });
  });

  describe('runWebsiteScan API Service', () => {
    it('successfully receives and returns real scan data from backend endpoint', async () => {
      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/scans/preview') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                url: 'https://example.com',
                finalUrl: 'https://example.com/',
                title: 'Example Domain',
                httpStatus: 200,
                headingCount: 1,
                loadTimeMs: 150,
                scanDurationMs: 450,
                summary: {
                  totalFindings: 0,
                  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
                },
                checks: {
                  pageLoad: { status: 'passed' },
                },
                findings: [],
              },
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const result = await runWebsiteScan('https://example.com');
        assert.ok(result);
        assert.equal(result.url, 'https://example.com');
        assert.equal(result.title, 'Example Domain');
        assert.equal(result.httpStatus, 200);
        assert.equal(result.summary.totalFindings, 0);
        assert.deepEqual(result.findings, []);
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('handles non-2xx backend error responses gracefully', async () => {
      const mockBackend = http.createServer((req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Invalid URL: Target IP is restricted',
            code: 'RESTRICTED_IP',
          })
        );
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        await assert.rejects(
          async () => {
            await runWebsiteScan('http://169.254.169.254');
          },
          (err) => {
            assert.match(err.message, /Target IP is restricted/i);
            assert.equal(err.code, 'RESTRICTED_IP');
            assert.equal(err.status, 400);
            return true;
          }
        );
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('handles malformed non-JSON server responses without crashing', async () => {
      const mockBackend = http.createServer((req, res) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway Nginx Error');
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        await assert.rejects(
          async () => {
            await runWebsiteScan('https://example.com');
          },
          (err) => {
            assert.match(err.message, /unparseable response/i);
            return true;
          }
        );
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('handles network failure when backend is unreachable', async () => {
      // Point to an unused local port
      process.env.VITE_API_BASE_URL = 'http://127.0.0.1:59998';

      await assert.rejects(
        async () => {
          await runWebsiteScan('https://example.com');
        },
        (err) => {
          assert.match(err.message, /Unable to reach TestIT backend/i);
          return true;
        }
      );
    });
  });

  describe('Duplicate Submission Prevention Logic', () => {
    it('prevents initiating a new scan while another is active', () => {
      let isScanning = true;
      let callCount = 0;

      function mockTriggerScan(_url) {
        if (isScanning) {
          return { initiated: false, reason: 'Scan in progress' };
        }
        callCount++;
        return { initiated: true };
      }

      const attempt1 = mockTriggerScan('https://example.com');
      assert.equal(attempt1.initiated, false);
      assert.equal(callCount, 0);

      isScanning = false;
      const attempt2 = mockTriggerScan('https://example.com');
      assert.equal(attempt2.initiated, true);
      assert.equal(callCount, 1);
    });
  });

  describe('Functional Test API Client Methods', () => {
    it('getFunctionalTestSchema retrieves supported actions and sample test', async () => {
      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/api/functional-tests/schema') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                supportedActions: ['navigate', 'click', 'fill', 'assertVisible'],
                supportedStrategies: ['role', 'label', 'placeholder', 'text', 'css'],
                sampleTest: { name: 'Sample' },
              },
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const schema = await getFunctionalTestSchema();
        assert.ok(schema);
        assert.deepEqual(schema.supportedActions, ['navigate', 'click', 'fill', 'assertVisible']);
        assert.equal(schema.sampleTest.name, 'Sample');
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('validateFunctionalTest returns validation results from backend', async () => {
      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/functional-tests/validate') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              valid: true,
              normalizedDefinition: { name: 'Valid Test' },
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const result = await validateFunctionalTest({ name: 'Valid Test' });
        assert.equal(result.valid, true);
        assert.equal(result.normalizedDefinition.name, 'Valid Test');
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('executeFunctionalTest executes test and returns full structured execution report', async () => {
      const mockReport = {
        testName: 'Search Medicine Flow',
        status: 'passed',
        totalSteps: 2,
        executedSteps: 2,
        passedSteps: 2,
        failedSteps: 0,
        steps: [
          {
            stepIndex: 1,
            action: 'navigate',
            description: 'Navigate to site',
            status: 'passed',
            durationMs: 320,
            expected: 'Navigate to https://example.com',
            actual: 'Landed on https://example.com',
          },
          {
            stepIndex: 2,
            action: 'assertVisible',
            description: 'Check search bar',
            status: 'passed',
            durationMs: 80,
            expected: 'Search input is visible',
            actual: 'Element is visible',
          },
        ],
      };

      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/functional-tests/execute') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: mockReport }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const report = await executeFunctionalTest({ name: 'Search Medicine Flow' });
        assert.ok(report);
        assert.equal(report.testName, 'Search Medicine Flow');
        assert.equal(report.status, 'passed');
        assert.equal(report.totalSteps, 2);
        assert.equal(report.steps[0].action, 'navigate');
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('executeFunctionalTest rejects when backend reports validation errors', async () => {
      const mockBackend = http.createServer((req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Invalid test definition',
            errors: ['Test name is required.', 'Step 1 target is missing.'],
          })
        );
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        await assert.rejects(
          async () => {
            await executeFunctionalTest({});
          },
          (err) => {
            assert.match(err.message, /Test name is required/i);
            assert.equal(err.status, 400);
            return true;
          }
        );
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });
  });

  describe('executeAiTest API Service', () => {
    it('successfully posts url and instructions to /api/ai-tests/run and returns report', async () => {
      const mockReport = {
        testName: 'AI Test: Paracetamol Search',
        status: 'passed',
        objective: 'Search for Paracetamol and verify results',
        planner: { mode: 'deterministic_fallback', aiConfigured: false },
        totalSteps: 3,
        executedSteps: 3,
        passedSteps: 3,
        failedSteps: 0,
        steps: [
          {
            stepIndex: 1,
            action: 'navigate',
            status: 'passed',
            expected: 'Navigate to site',
            actual: 'Landed on site',
          },
        ],
      };

      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/ai-tests/run') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: mockReport }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const report = await executeAiTest({
          url: 'https://example.com',
          instructions: 'Search for Paracetamol',
        });

        assert.ok(report);
        assert.equal(report.status, 'passed');
        assert.equal(report.objective, 'Search for Paracetamol and verify results');
        assert.equal(report.totalSteps, 3);
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('successfully handles unsupported test report and preserves user instructions', async () => {
      const mockUnsupportedReport = {
        testName: 'AI Website Test',
        status: 'unsupported',
        objective: 'Unsupported objective: Create a ticket and edit title',
        instructions: 'Create a ticket and edit title',
        userInstructions: 'Create a ticket and edit title',
        blockedReason:
          'The deterministic fallback engine cannot reliably interpret or plan this custom objective without an AI model.',
        planner: { mode: 'deterministic_fallback', aiConfigured: false },
        totalSteps: 0,
        executedSteps: 0,
        passedSteps: 0,
        failedSteps: 0,
        steps: [],
      };

      const mockBackend = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/ai-tests/run') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: mockUnsupportedReport }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        const report = await executeAiTest({
          url: 'https://example.com',
          instructions: 'Create a ticket and edit title',
        });

        assert.ok(report);
        assert.equal(report.status, 'unsupported');
        assert.equal(report.totalSteps, 0);
        assert.equal(report.passedSteps, 0);
        assert.match(report.blockedReason, /cannot reliably interpret or plan/i);
        assert.equal(report.userInstructions, 'Create a ticket and edit title');
        assert.deepEqual(report.steps, []);
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });

    it('rejects gracefully when backend returns HTTP error', async () => {
      const mockBackend = http.createServer((req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            message: 'Testing instructions are required',
            code: 'MISSING_INSTRUCTIONS',
          })
        );
      });

      await new Promise((resolve) => mockBackend.listen(0, '127.0.0.1', resolve));
      const port = mockBackend.address().port;
      process.env.VITE_API_BASE_URL = `http://127.0.0.1:${port}`;

      try {
        await assert.rejects(
          async () => {
            await executeAiTest({ url: 'https://example.com', instructions: '' });
          },
          (err) => {
            assert.match(err.message, /instructions are required/i);
            assert.equal(err.status, 400);
            assert.equal(err.code, 'MISSING_INSTRUCTIONS');
            return true;
          }
        );
      } finally {
        await new Promise((resolve) => mockBackend.close(resolve));
      }
    });
  });
});
