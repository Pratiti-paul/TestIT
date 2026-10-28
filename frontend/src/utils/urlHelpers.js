/**
 * Validates a website URL on the client-side.
 * Accepts only HTTP and HTTPS protocols.
 * Authoritative security and SSRF validation is enforced by the backend.
 *
 * @param {string} input
 * @returns {{ isValid: boolean, error?: string, url?: string }}
 */
export function validateClientUrl(input) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      isValid: false,
      error: 'Please enter a website URL.',
    };
  }

  const trimmed = input.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      isValid: false,
      error: 'URL must start with http:// or https:// (e.g. https://example.com)',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        isValid: false,
        error: 'Only HTTP and HTTPS protocols are supported.',
      };
    }

    if (!parsed.hostname) {
      return {
        isValid: false,
        error: 'URL must include a valid hostname.',
      };
    }

    return {
      isValid: true,
      url: trimmed,
    };
  } catch {
    return {
      isValid: false,
      error: 'Please enter a valid URL syntax (e.g. https://example.com).',
    };
  }
}

