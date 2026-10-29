/**
 * Resolves the backend API base URL from Vite environment variables,
 * Node environment variables (during testing), or default fallback.
 * Defaults to port 5001 to avoid the macOS ControlCenter / AirPlay Receiver conflict on 5000.
 *
 * @returns {string}
 */
export function getApiBaseUrl() {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
    'http://localhost:5001';

  return envUrl.replace(/\/+$/, '');
}

/**
 * Returns candidate base URLs to attempt if the configured URL suffers from a local port conflict.
 * Only attempts fallback ports if the configured URL targets port 5000 (which conflicts with macOS AirPlay).
 *
 * @returns {string[]}
 */
export function getCandidateBaseUrls() {
  const primary = getApiBaseUrl();
  if (primary.includes(':5000')) {
    return [primary, 'http://localhost:5001', 'http://127.0.0.1:5001', 'http://[::1]:5000'];
  }
  return [primary];
}

/**
 * Sends a website scan request to the TestIT backend scanner endpoint.
 *
 * @param {string} url - Target URL to inspect
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<object>} - Scan report data
 */
export async function runWebsiteScan(url, signal) {
  const candidates = getCandidateBaseUrls();
  let lastError = null;

  for (const baseUrl of candidates) {
    const endpoint = `${baseUrl}/api/scans/preview`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        const parseErr = new Error(`Server returned an unparseable response (HTTP ${response.status}).`);
        parseErr.status = response.status;
        throw parseErr;
      }

      if (!response.ok || !data.success) {
        const message = data?.message || `Scan failed with status code ${response.status}`;
        const error = new Error(message);
        error.code = data?.code || 'SCAN_ERROR';
        error.status = response.status;
        throw error;
      }

      return data.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Scan request was canceled.');
      }
      if (err.status) {
        throw err;
      }
      lastError = err;
    }
  }

  throw new Error(
    `Unable to reach TestIT backend at ${getApiBaseUrl()}. Ensure the backend server is running and accessible.`
  );
}

/**
 * Retrieves the supported functional test step actions, strategies, and sample test.
 *
 * @returns {Promise<object>}
 */
export async function getFunctionalTestSchema() {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/functional-tests/schema`;

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to retrieve functional test schema (HTTP ${response.status}).`);
  }

  const data = await response.json();
  return data.data;
}

/**
 * Validates a functional test definition on the backend.
 *
 * @param {object} definition
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateFunctionalTest(definition) {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/functional-tests/validate`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });

  const data = await response.json();
  return data;
}

/**
 * Executes a functional test against an authorized website.
 *
 * @param {object} definition
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} Execution report
 */
export async function executeFunctionalTest(definition, signal) {
  const candidates = getCandidateBaseUrls();
  let lastError = null;

  for (const baseUrl of candidates) {
    const endpoint = `${baseUrl}/api/functional-tests/execute`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
        signal,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        const parseErr = new Error(`Server returned an unparseable response (HTTP ${response.status}).`);
        parseErr.status = response.status;
        throw parseErr;
      }

      if (!response.ok || !data.success) {
        const message =
          data?.errors && data.errors.length > 0
            ? data.errors.join(' ')
            : data?.message || `Test failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.code = data?.code || 'TEST_ERROR';
        error.errors = data?.errors;
        throw error;
      }

      return data.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Functional test execution was canceled.');
      }
      if (err.status) {
        throw err;
      }
      lastError = err;
    }
  }

  throw new Error(
    `Unable to reach TestIT backend at ${getApiBaseUrl()}. Ensure the backend server is running.`
  );
}

/**
 * Executes an AI-driven website test:
 * Sends the URL, natural-language instructions, and optional test credentials to the backend.
 * Seamlessly attempts fallback ports if macOS ControlCenter / AirPlay Receiver intercepts port 5000.
 *
 * @param {object} payload
 * @param {string} payload.url - Target website URL
 * @param {string} payload.instructions - Natural-language testing instructions
 * @param {object} [payload.credentials] - Optional test credentials { username, password }
 * @param {boolean} [payload.authorized] - User confirmation of test authorization
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<object>} Complete AI test report
 */
export async function executeAiTest(payload, signal) {
  const candidates = getCandidateBaseUrls();
  let lastError = null;

  for (const baseUrl of candidates) {
    const endpoint = `${baseUrl}/api/ai-tests/run`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        const parseErr = new Error(`Server returned an unparseable response (HTTP ${response.status}).`);
        parseErr.status = response.status;
        throw parseErr;
      }

      if (!response.ok || !data.success) {
        const message = data?.message || `AI test failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.code = data?.code || 'AI_TEST_ERROR';
        throw error;
      }

      return data.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('AI test execution was canceled.');
      }
      if (err.status) {
        throw err;
      }
      lastError = err;
    }
  }

  throw new Error(
    `Unable to reach TestIT backend at ${getApiBaseUrl()}. Ensure the backend server is running and accessible.`
  );
}
