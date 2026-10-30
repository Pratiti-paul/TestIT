/**
 * Generic Bounded Retry and Exponential Backoff Utility for TestIT AI Providers.
 *
 * Implements:
 * - Exponential backoff with randomized jitter to prevent retry storms.
 * - Respects provider's Retry-After response headers (seconds or date format).
 * - Maximum retry count (configurable via options or AI_PROVIDER_MAX_RETRIES).
 * - Total retry duration budget (configurable via AI_PROVIDER_RETRY_TIMEOUT_MS).
 * - Non-retryable error detection: immediate abort for permanent quota exhaustion,
 *   invalid API keys (401/403), and non-transient client errors.
 */

import { classifyProviderError, ProviderError } from './providerSanitizer.js';

export async function executeWithRetry(operation, options = {}) {
  const maxRetries =
    options.maxRetries !== undefined
      ? options.maxRetries
      : parseInt(process.env.AI_PROVIDER_MAX_RETRIES || '3', 10);

  const baseDelayMs =
    options.baseDelayMs !== undefined
      ? options.baseDelayMs
      : parseInt(process.env.AI_PROVIDER_BASE_DELAY_MS || '1000', 10);

  const maxDelayMs =
    options.maxDelayMs !== undefined
      ? options.maxDelayMs
      : parseInt(process.env.AI_PROVIDER_MAX_DELAY_MS || '10000', 10);

  const totalTimeoutMs =
    options.totalTimeoutMs !== undefined
      ? options.totalTimeoutMs
      : parseInt(process.env.AI_PROVIDER_RETRY_TIMEOUT_MS || '35000', 10);

  const jitterFactor = options.jitterFactor !== undefined ? options.jitterFactor : 0.2;
  const providerName = options.providerName || 'AI Provider';
  const apiKey = options.apiKey || null;
  const onRetry = options.onRetry || null;

  const startTime = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;

      // Classify error to determine retryability
      const classified =
        err instanceof ProviderError
          ? {
              isRetryable: err.isRetryable,
              isQuotaExhausted: err.isQuotaExhausted,
              retryAfterMs: err.retryAfterMs,
              category: err.category,
              message: err.message,
              status: err.status,
            }
          : classifyProviderError(err, {
              providerName,
              apiKey,
              status: err.status,
              headers: err.headers,
              timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 15000,
            });

      // If permanently non-retryable (e.g. auth error, permanent quota exhausted, bad request): abort immediately!
      if (!classified.isRetryable) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(classified.message, {
          providerName,
          category: classified.category,
          status: classified.status,
          isRetryable: false,
          isQuotaExhausted: classified.isQuotaExhausted,
          retryAfterMs: classified.retryAfterMs,
        });
      }

      // If we have exhausted all attempts:
      if (attempt > maxRetries) {
        const errorMsg = `${providerName} request failed after ${maxRetries} retries: ${classified.message}`;
        throw new ProviderError(errorMsg, {
          providerName,
          category: classified.category,
          status: classified.status,
          isRetryable: false,
          isQuotaExhausted: classified.isQuotaExhausted,
          retryAfterMs: classified.retryAfterMs,
        });
      }

      // Determine backoff delay:
      let delay;
      if (classified.retryAfterMs && classified.retryAfterMs > 0) {
        delay = Math.min(classified.retryAfterMs, maxDelayMs);
      } else {
        const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = expDelay * (Math.random() * (2 * jitterFactor) - jitterFactor);
        delay = Math.min(maxDelayMs, Math.max(100, Math.round(expDelay + jitter)));
      }

      const elapsed = Date.now() - startTime;
      if (elapsed + delay > totalTimeoutMs) {
        const budgetMsg = `${providerName} retry budget exhausted after ${elapsed}ms (${attempt} attempts). ${classified.message}`;
        throw new ProviderError(budgetMsg, {
          providerName,
          category: 'retry_budget_exhausted',
          status: classified.status,
          isRetryable: false,
          isQuotaExhausted: classified.isQuotaExhausted,
          retryAfterMs: classified.retryAfterMs,
        });
      }

      if (typeof onRetry === 'function') {
        try {
          onRetry({ attempt, delay, error: err, classified });
        } catch {}
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (lastError instanceof ProviderError) {
    throw lastError;
  }

  const finalClassified = classifyProviderError(lastError, {
    providerName,
    apiKey,
    status: lastError?.status,
    headers: lastError?.headers,
    timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : 15000,
  });

  throw new ProviderError(finalClassified.message, {
    providerName,
    category: finalClassified.category,
    status: finalClassified.status,
    isRetryable: false,
    isQuotaExhausted: finalClassified.isQuotaExhausted,
    retryAfterMs: finalClassified.retryAfterMs,
  });
}
