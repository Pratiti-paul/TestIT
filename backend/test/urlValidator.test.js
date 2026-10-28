import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, isIpBlocked, isHostnameBlocked } from '../src/utils/urlValidator.js';

describe('urlValidator', () => {
  describe('Input validation', () => {
    it('rejects missing or empty URL', async () => {
      const res1 = await validateUrl('');
      assert.equal(res1.isValid, false);
      assert.equal(res1.code, 'MISSING_URL');

      const res2 = await validateUrl(null);
      assert.equal(res2.isValid, false);
      assert.equal(res2.code, 'MISSING_URL');
    });

    it('rejects malformed URLs', async () => {
      const res = await validateUrl('httpx:////invalid');
      assert.equal(res.isValid, false);
    });

    it('rejects unsupported protocols', async () => {
      const protocols = [
        'ftp://example.com/file.txt',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<h1>Test</h1>',
        'ws://example.com/socket',
      ];

      for (const url of protocols) {
        const res = await validateUrl(url);
        assert.equal(res.isValid, false, `Expected ${url} to be rejected`);
        assert.equal(res.code, 'UNSUPPORTED_PROTOCOL');
      }
    });

    it('rejects URLs with embedded credentials', async () => {
      const res1 = await validateUrl('https://user:password@example.com');
      assert.equal(res1.isValid, false);
      assert.equal(res1.code, 'CREDENTIALS_NOT_ALLOWED');

      const res2 = await validateUrl('http://admin@example.com');
      assert.equal(res2.isValid, false);
      assert.equal(res2.code, 'CREDENTIALS_NOT_ALLOWED');
    });
  });

  describe('Hostname restrictions', () => {
    it('identifies and blocks localhost and internal domain patterns', () => {
      assert.equal(isHostnameBlocked('localhost'), true);
      assert.equal(isHostnameBlocked('sub.localhost'), true);
      assert.equal(isHostnameBlocked('printer.local'), true);
      assert.equal(isHostnameBlocked('service.internal'), true);
      assert.equal(isHostnameBlocked('router.lan'), true);
      assert.equal(isHostnameBlocked('nas.home'), true);
      assert.equal(isHostnameBlocked('metadata.google.internal'), true);
      assert.equal(isHostnameBlocked('instance-data'), true);
      assert.equal(isHostnameBlocked('example.com'), false);
    });

    it('rejects URLs with blocked hostnames', async () => {
      const blocked = [
        'http://localhost',
        'http://localhost:5000',
        'http://test.localhost',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://printer.local',
      ];

      for (const url of blocked) {
        const res = await validateUrl(url);
        assert.equal(res.isValid, false, `Expected ${url} to be blocked`);
      }
    });
  });

  describe('IP address restrictions', () => {
    it('blocks loopback IP addresses (IPv4 & IPv6)', () => {
      assert.equal(isIpBlocked('127.0.0.1').blocked, true);
      assert.equal(isIpBlocked('127.0.0.2').blocked, true);
      assert.equal(isIpBlocked('::1').blocked, true);
      assert.equal(isIpBlocked('::ffff:127.0.0.1').blocked, true);
    });

    it('blocks private IP addresses (IPv4 & IPv6)', () => {
      assert.equal(isIpBlocked('10.0.0.1').blocked, true);
      assert.equal(isIpBlocked('172.16.0.1').blocked, true);
      assert.equal(isIpBlocked('192.168.1.1').blocked, true);
      assert.equal(isIpBlocked('fc00::1').blocked, true);
      assert.equal(isIpBlocked('fd00::1').blocked, true);
    });

    it('blocks link-local and cloud metadata addresses', () => {
      assert.equal(isIpBlocked('169.254.169.254').blocked, true);
      assert.equal(isIpBlocked('169.254.1.1').blocked, true);
      assert.equal(isIpBlocked('fe80::1').blocked, true);
      assert.equal(isIpBlocked('100.100.100.200').blocked, true);
      assert.equal(isIpBlocked('::ffff:169.254.169.254').blocked, true);
    });

    it('blocks reserved and special addresses', () => {
      assert.equal(isIpBlocked('0.0.0.0').blocked, true);
      assert.equal(isIpBlocked('255.255.255.255').blocked, true);
      assert.equal(isIpBlocked('100.64.0.1').blocked, true); // Carrier-grade NAT
      assert.equal(isIpBlocked('192.0.2.1').blocked, true);  // Documentation
    });

    it('allows valid public unicast IP addresses', () => {
      assert.equal(isIpBlocked('8.8.8.8').blocked, false);
      assert.equal(isIpBlocked('1.1.1.1').blocked, false);
      assert.equal(isIpBlocked('2607:f8b0:4005:808::200e').blocked, false);
    });

    it('rejects URLs with direct private or loopback IP addresses', async () => {
      const blockedIps = [
        'http://127.0.0.1:8080',
        'http://10.0.0.5',
        'http://192.168.1.100',
        'http://169.254.169.254/latest/meta-data',
        'http://[::1]',
        'http://[::ffff:127.0.0.1]',
      ];

      for (const url of blockedIps) {
        const res = await validateUrl(url);
        assert.equal(res.isValid, false, `Expected ${url} to be blocked`);
        assert.equal(res.code, 'RESTRICTED_IP');
      }
    });
  });

  describe('DNS resolution & validation', () => {
    it('validates a legitimate public domain', async () => {
      const res = await validateUrl('https://example.com');
      assert.equal(res.isValid, true);
      assert.equal(res.hostname, 'example.com');
      assert.equal(res.protocol, 'https:');
      assert.ok(res.resolvedIps.length > 0);
      assert.ok(res.primaryIp);
    });

    it('rejects unreachable or unresolvable domains', async () => {
      const res = await validateUrl('https://unresolvable-domain-testit-xyz-987.org');
      assert.equal(res.isValid, false);
      assert.equal(res.code, 'DNS_RESOLUTION_FAILED');
    });
  });
});

