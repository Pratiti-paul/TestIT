import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scanWebsite, ScannerError } from '../src/services/scanService.js';

describe('Quality Checks Suite', () => {
  // 1. A page that loads successfully with no issues
  it('1. successfully scans a clean page without findings', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Clean Test Page</title>
              <meta name="description" content="A clean description">
            </head>
            <body>
              <h1>Clean Heading</h1>
              <p>Content</p>
              <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Tiny Pixel">
              <a href="/target">Target Link</a>
            </body>
          </html>
        `);
      } else if (req.url === '/target') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Target Page</h1>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.httpStatus, 200);
      assert.equal(result.title, 'Clean Test Page');
      assert.equal(result.checks.pageLoad.status, 'passed');
      assert.equal(result.checks.pageMetadata.status, 'passed');
      assert.equal(result.checks.brokenImages.status, 'passed');
      assert.equal(result.checks.brokenLinks.status, 'passed');
      assert.equal(result.checks.javascriptErrors.status, 'passed');
      assert.equal(result.checks.accessibility.status, 'passed');
      assert.equal(result.findings.length, 0);
      assert.equal(result.summary.totalFindings, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 2. A page with a missing title and H1
  it('2. detects missing page title and missing H1 heading', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <!-- Missing title -->
          </head>
          <body>
            <p>Body without any H1 element</p>
          </body>
        </html>
      `);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.pageMetadata.status, 'issues_found');

      const metaFindings = result.findings.filter((f) => f.category === 'missing-metadata');
      const titleFinding = metaFindings.find((f) => f.title === 'Missing page title');
      const h1Finding = metaFindings.find((f) => f.title === 'Missing H1 heading');

      assert.ok(titleFinding, 'Expected finding for missing title');
      assert.ok(h1Finding, 'Expected finding for missing H1 heading');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 3. A page with a broken image
  it('3. detects images that fail to load or have zero natural dimensions', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Broken Image Test</title></head>
            <body>
              <h1>Header</h1>
              <img id="bad-img" src="/non-existent-image.png" alt="Broken">
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.brokenImages.status, 'issues_found');
      assert.ok(result.checks.brokenImages.issuesCount >= 1);

      const brokenImgFinding = result.findings.find((f) => f.category === 'broken-image');
      assert.ok(brokenImgFinding);
      assert.ok(brokenImgFinding.url.includes('/non-existent-image.png'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 4. A same-origin link returning HTTP 404
  it('4. detects same-origin links returning HTTP 404', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Broken Link Test</title></head>
            <body>
              <h1>Broken Link Test</h1>
              <a href="/missing-page">Click Here</a>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.brokenLinks.status, 'issues_found');

      const brokenLinkFinding = result.findings.find((f) => f.category === 'broken-link');
      assert.ok(brokenLinkFinding);
      assert.equal(brokenLinkFinding.evidence.statusCode, 404);
      assert.ok(brokenLinkFinding.url.includes('/missing-page'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 5. A JavaScript runtime error
  it('5. captures uncaught JavaScript runtime errors on the page', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>JS Crash Test</title>
            <script>
              throw new Error("Deliberate client script crash");
            </script>
          </head>
          <body>
            <h1>JS Crash Test</h1>
          </body>
        </html>
      `);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.javascriptErrors.status, 'issues_found');

      const jsFinding = result.findings.find((f) => f.category === 'javascript-error');
      assert.ok(jsFinding);
      assert.ok(jsFinding.message.includes('Deliberate client script crash'));
      assert.equal(jsFinding.severity, 'high');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 6. A failed network request
  it('6. records failed subresource network requests', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Failed Request Test</title>
              <script src="/failing-script.js"></script>
            </head>
            <body>
              <h1>Network Failure Test</h1>
            </body>
          </html>
        `);
      } else if (req.url === '/failing-script.js') {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.networkRequests.status, 'issues_found');

      const netFinding = result.findings.find((f) => f.category === 'failed-request');
      assert.ok(netFinding);
      assert.ok(netFinding.url.includes('/failing-script.js'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 7. Duplicate links being checked only once
  it('7. deduplicates links and removes fragments to check each URL only once', async () => {
    let checkCount = 0;

    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Deduplication Test</title></head>
            <body>
              <h1>Deduplication Test</h1>
              <a href="/target">Target 1</a>
              <a href="/target#section1">Target Section 1</a>
              <a href="/target#section2">Target Section 2</a>
              <a href="/target">Target Duplicate</a>
            </body>
          </html>
        `);
      } else if (req.url === '/target') {
        checkCount++;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Target Page</h1>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.brokenLinks.totalFound, 1);
      assert.equal(result.checks.brokenLinks.totalChecked, 1);
      assert.equal(checkCount, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 8. Link-check and total scan limits
  it('8. caps link checks to maximum 30 links per scan', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        // Generate 35 distinct same-origin links
        const links = Array.from({ length: 35 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join('\n');
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Limit Test</title></head>
            <body>
              <h1>Limit Test</h1>
              ${links}
            </body>
          </html>
        `);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>OK</h1>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
      });

      assert.equal(result.checks.brokenLinks.totalFound, 35);
      assert.equal(result.checks.brokenLinks.totalChecked, 30);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 9. A check timing out without crashing the entire scan
  it('9. handles link-check timeouts gracefully without crashing the scan', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Timeout Test</title></head>
            <body>
              <h1>Timeout Test</h1>
              <a href="/hanging-link">Hanging Link</a>
            </body>
          </html>
        `);
      } else if (req.url === '/hanging-link') {
        // Intentionally do not reply to trigger timeout
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await scanWebsite(`http://127.0.0.1:${port}/`, {
        allowLocalForTesting: true,
        linkTimeoutMs: 300, // Short timeout for rapid test
      });

      // The overall scan should succeed
      assert.equal(result.httpStatus, 200);
      assert.equal(result.title, 'Timeout Test');
      assert.equal(result.checks.pageLoad.status, 'passed');

      // The link check should record a timeout finding
      assert.equal(result.checks.brokenLinks.status, 'issues_found');
      const timeoutFinding = result.findings.find((f) => f.title === 'Link check timed out');
      assert.ok(timeoutFinding);
      assert.ok(timeoutFinding.url.includes('/hanging-link'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 10. Blocked private/internal destinations and redirects remain blocked
  it('10. keeps private/internal destinations and redirects blocked', async () => {
    // Direct submission of metadata IP
    await assert.rejects(
      async () => {
        await scanWebsite('http://169.254.169.254/latest/meta-data');
      },
      (err) => {
        assert.ok(err instanceof ScannerError);
        assert.equal(err.code, 'RESTRICTED_IP');
        return true;
      }
    );

    // Direct submission of private RFC 1918 IP
    await assert.rejects(
      async () => {
        await scanWebsite('http://192.168.1.1');
      },
      (err) => {
        assert.ok(err instanceof ScannerError);
        assert.equal(err.code, 'RESTRICTED_IP');
        return true;
      }
    );

    // Redirect to blocked destination
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/secret' });
      res.end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      await assert.rejects(
        async () => {
          await scanWebsite(`http://127.0.0.1:${port}/`, {
            allowLocalForTesting: true,
            timeoutMs: 3000,
          });
        },
        (err) => {
          assert.ok(err instanceof ScannerError);
          assert.equal(err.code, 'SECURITY_BLOCKED');
          return true;
        }
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

