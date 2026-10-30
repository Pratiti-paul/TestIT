/**
 * Provider Error Sanitizer and Classifier for TestIT Autonomous QA Agent.
 *
 * Ensures all outbound LLM errors, network failures, timeouts, and quota errors
 * are scrubbed of secrets, credentials, API keys, and authorization headers,
 * while classifying them into safe diagnostic categories.
 */

/**
 * Custom error class for sanitized AI provider errors.
 */
export class ProviderError extends Error {
  constructor(message, { providerName = 'AI Provider', category = 'provider_error', status = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.providerName = providerName;
    this.category = category;
    this.status = status;
  }
}

/**
 * Redacts known secrets and secret-bearing URL patterns, Bearer tokens, and auth headers from text.
 *
 * @param {string} text
 * @param {string[]} [secrets=[]]
 * @returns {string}
 */
export function redactSecrets(text, secrets = []) {
  if (!text || typeof text !== 'string') return text ? String(text) : '';
  let sanitized = text;

  // 1. Redact explicit secrets
  if (Array.isArray(secrets)) {
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.trim().length > 2) {
        sanitized = sanitized.split(secret.trim()).join('[REDACTED]');
      }
    }
  }

  // 2. Redact common secret-bearing query parameters (e.g. ?key=..., &api_key=...)
  sanitized = sanitized.replace(
    /([?&](?:key|api_key|apiKey|token|secret|password|access_token|auth)=)[^&\s"'`]+/gi,
    '$1[REDACTED]'
  );

  // 3. Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');

  // 4. Redact x-goog-api-key header references
  sanitized = sanitized.replace(/x-goog-api-key:\s*[^\s"'`,]+/gi, 'x-goog-api-key: [REDACTED]');

  // 5. Redact synthetic test secret patterns (e.g. TEST_SECRET_...)
  sanitized = sanitized.replace(/TEST_SECRET_[A-Za-z0-9_]+/g, '[REDACTED]');

  return sanitized;
}

/**
 * Classifies an error into a safe diagnostic category and produces a clean, non-leaking message.
 *
 * @param {Error | string} err
 * @param {object} [context]
 * @param {string} [context.providerName='AI Provider']
 * @param {number | null} [context.status=null]
 * @param {number} [context.timeoutMs=15000]
 * @param {string | null} [context.apiKey=null]
 * @returns {{ category: string, message: string, status: number | null }}
 */
export function classifyProviderError(
  err,
  { providerName = 'AI Provider', status = null, timeoutMs = 15000, apiKey = null } = {}
) {
  const secrets = apiKey ? [apiKey] : [];
  const rawMsg = err?.message || (typeof err === 'string' ? err : 'Unknown error');
  const sanitizedRaw = redactSecrets(rawMsg, secrets);

  const isTimeout =
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    err?.code === 23 ||
    /timed?\s*out|aborted/i.test(sanitizedRaw);

  if (isTimeout) {
    return {
      category: 'timeout',
      message: `Request to ${providerName} timed out after ${timeoutMs}ms.`,
      status: 408,
    };
  }

  const isAuth =
    status === 401 ||
    status === 403 ||
    /HTTP (?:401|403)/i.test(sanitizedRaw) ||
    /unauthorized|forbidden|invalid.*key|invalid_api_key/i.test(sanitizedRaw);

  if (isAuth) {
    return {
      category: 'authentication_error',
      message: `${providerName} authentication failed. Please verify that the configured API key is valid.`,
      status: status || 401,
    };
  }

  const isRateLimit =
    status === 429 ||
    /HTTP 429/i.test(sanitizedRaw) ||
    /rate\s*limit|quota|resource_exhausted/i.test(sanitizedRaw);

  if (isRateLimit) {
    return {
      category: 'rate_limit_error',
      message: `${providerName} rate limit or quota exceeded. Please check your account usage or retry later.`,
      status: status || 429,
    };
  }

  const isServiceError =
    (status >= 500 && status < 600) ||
    /HTTP 5\d\d/i.test(sanitizedRaw) ||
    /internal.*server|bad.*gateway|service.*unavailable/i.test(sanitizedRaw);

  if (isServiceError) {
    return {
      category: 'service_error',
      message: `${providerName} service error (HTTP ${status || '5xx'}). The AI provider is temporarily unavailable.`,
      status: status || 503,
    };
  }

  const isTruncated = /truncated|finish_reason:\s*length|finishReason:\s*MAX_TOKENS|max_tokens/i.test(sanitizedRaw);
  if (isTruncated) {
    return {
      category: 'malformed_response',
      message: `${providerName} output was truncated due to output token limits. Expected a complete structured JSON response.`,
      status: null,
    };
  }

  const isMalformed =
    /JSON|SyntaxError|did not contain|empty response|invalid action schema/i.test(sanitizedRaw);
  if (isMalformed) {
    return {
      category: 'malformed_response',
      message: `${providerName} returned a malformed or empty response that could not be parsed into valid JSON.`,
      status: null,
    };
  }

  const isNetwork = /ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(sanitizedRaw);
  if (isNetwork) {
    return {
      category: 'network_error',
      message: `Failed to connect to ${providerName} API. Check network connectivity and DNS resolution.`,
      status: null,
    };
  }

  // Safe fallback (stripped of any potential URLs with query strings, headers, or secrets)
  const safeSnippet = sanitizedRaw.slice(0, 150).replace(/\s+/g, ' ').trim();
  return {
    category: 'provider_error',
    message: `${providerName} request failed: ${safeSnippet}`,
    status,
  };
}

/**
 * Creates a classified ProviderError from an HTTP error response.
 */
export function createProviderHttpError({ providerName, status, rawBody, apiKey }) {
  const classified = classifyProviderError(new Error(rawBody || `HTTP ${status}`), {
    providerName,
    status,
    apiKey,
  });
  return new ProviderError(classified.message, {
    providerName,
    category: classified.category,
    status: classified.status,
  });
}

/**
 * Wraps an arbitrary caught error into a safe ProviderError.
 */
export function wrapProviderError(err, { providerName, apiKey, timeoutMs }) {
  if (err instanceof ProviderError) return err;
  const classified = classifyProviderError(err, {
    providerName,
    apiKey,
    timeoutMs,
  });
  return new ProviderError(classified.message, {
    providerName,
    category: classified.category,
    status: classified.status,
  });
}

/**
 * Sanitizes an error message string against a list of secrets.
 */
export function sanitizeErrorString(str, secrets = []) {
  return redactSecrets(str, secrets);
}

