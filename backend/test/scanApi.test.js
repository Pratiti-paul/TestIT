import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

describe('Express API Endpoints', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      // Listen on ephemeral port on localhost
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('GET /api/health', () => {
    it('returns HTTP 200 with service info', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.message, 'TestIT backend is running');
      assert.equal(json.service, 'TestIT API');
    });
  });

  describe('POST /api/scans/preview validation', () => {
    it('returns HTTP 400 when body is missing url', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'MISSING_URL');
    });

    it('returns HTTP 400 for unsupported protocols', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/hosts' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'UNSUPPORTED_PROTOCOL');
    });

    it('returns HTTP 400 for embedded credentials', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://user:secret@example.com' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'CREDENTIALS_NOT_ALLOWED');
    });

    it('returns HTTP 400 for localhost and loopback targets', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:5000' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'RESTRICTED_IP');
    });

    it('returns HTTP 400 for private IP addresses', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.1.1' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'RESTRICTED_IP');
    });

    it('returns HTTP 400 for cloud metadata targets', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'RESTRICTED_IP');
    });

    it('returns HTTP 400 for malformed JSON request', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json }',
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, 'INVALID_JSON');
    });
  });

  describe('Route not found', () => {
    it('returns HTTP 404 JSON for unknown API routes', async () => {
      const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.success, false);
    });
  });

  describe('Live Scan Preview via API', () => {
    it('returns HTTP 200 and structured scan data for https://example.com', async () => {
      const res = await fetch(`${baseUrl}/api/scans/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data);
      assert.equal(json.data.url, 'https://example.com');
      assert.ok(json.data.finalUrl.startsWith('https://'));
      assert.equal(typeof json.data.title, 'string');
      assert.equal(json.data.httpStatus, 200);
      assert.equal(typeof json.data.headingCount, 'number');
      assert.equal(typeof json.data.loadTimeMs, 'number');
    });
  });
});

