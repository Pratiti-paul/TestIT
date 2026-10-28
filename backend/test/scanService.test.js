import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scanWebsite, ScannerError } from '../src/services/scanService.js';

describe('scanService', () => {
  describe('Input & security validation', () => {
    it('throws ScannerError for invalid protocol', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('ftp://example.com/file');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'UNSUPPORTED_PROTOCOL');
          return true;
        }
      );
    });

    it('throws ScannerError for embedded credentials', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('https://admin:secret@example.com');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'CREDENTIALS_NOT_ALLOWED');
          return true;
        }
      );
    });

    it('rejects loopback and localhost destinations', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('http://localhost:5000');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await scanWebsite('http://127.0.0.1:8080');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'RESTRICTED_IP');
          return true;
        }
      );
    });

    it('rejects private and link-local destinations', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('http://192.168.1.1');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'RESTRICTED_IP');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await scanWebsite('http://169.254.169.254/latest/meta-data');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'RESTRICTED_IP');
          return true;
        }
      );
    });

    it('rejects cloud metadata hostname', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('http://metadata.google.internal');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'BLOCKED_HOSTNAME');
          return true;
        }
      );
    });
  });

  describe('Scanner error handling & security interception', () => {
    it('handles unresolvable domain gracefully', async () => {
      await assert.rejects(
        async () => {
          await scanWebsite('https://this-host-does-not-exist-testit-xyz-987.com');
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.code, 'DNS_RESOLUTION_FAILED');
          return true;
        }
      );
    });

    it('handles navigation timeouts', async () => {
      // 1ms timeout will reliably trigger navigation timeout
      await assert.rejects(
        async () => {
          await scanWebsite('https://example.com', { timeoutMs: 1 });
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.statusCode, 504);
          assert.equal(err.code, 'NAVIGATION_TIMEOUT');
          return true;
        }
      );
    });

    it('intercepts and blocks redirects to cloud metadata IP', async () => {
      // Create a mock redirect server that attempts redirect to cloud metadata
      const mockServer = http.createServer((req, res) => {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      });

      await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
      const port = mockServer.address().port;
      const targetUrl = `http://127.0.0.1:${port}/redirect-to-metadata`;

      try {
        await assert.rejects(
          async () => {
            await scanWebsite(targetUrl, { allowLocalForTesting: true, timeoutMs: 4000 });
          },
          (err) => {
            assert.ok(err instanceof ScannerError);
            assert.equal(err.statusCode, 400);
            assert.equal(err.code, 'SECURITY_BLOCKED');
            return true;
          }
        );
      } finally {
        await new Promise((resolve) => mockServer.close(resolve));
      }
    });
  });

  describe('Live public scan', () => {
    it('successfully scans a public authorized test website (example.com)', async () => {
      const result = await scanWebsite('https://example.com');
      assert.ok(result);
      assert.equal(result.url, 'https://example.com');
      assert.ok(result.finalUrl.startsWith('https://'));
      assert.equal(typeof result.title, 'string');
      assert.ok(result.title.length > 0);
      assert.equal(result.httpStatus, 200);
      assert.equal(typeof result.headingCount, 'number');
      assert.ok(result.headingCount >= 0);
      assert.equal(typeof result.loadTimeMs, 'number');
      assert.ok(result.loadTimeMs > 0);
    });
  });
});
