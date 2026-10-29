/**
 * Resolves the backend API base URL from Vite environment variables,
 * Node environment variables (during testing), or default fallback.
 *
 * @returns {string}
 */
export function getApiBaseUrl() {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
    'http://localhost:5000';

  return envUrl.replace(/\/+$/, '');
}

/**
 * Sends a website scan request to the TestIT backend scanner endpoint.
 *
 * @param {string} url - Target URL to inspect
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<object>} - Scan report data
 */
export async function runWebsiteScan(url, signal) {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/scans/preview`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Scan request was canceled.');
    }
    throw new Error(
      `Unable to reach TestIT backend at ${baseUrl}. Ensure the backend server is running and accessible.`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned an unparseable response (HTTP ${response.status}).`);
  }

  if (!response.ok || !data.success) {
    const message = data?.message || `Scan failed with status code ${response.status}`;
    const error = new Error(message);
    error.code = data?.code || 'SCAN_ERROR';
    error.status = response.status;
    throw error;
  }

  return data.data;
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
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/functional-tests/execute`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(definition),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Functional test execution was canceled.');
    }
    throw new Error(
      `Unable to reach TestIT backend at ${baseUrl}. Ensure the backend server is running.`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned an unparseable response (HTTP ${response.status}).`);
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
}
