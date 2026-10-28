import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';

// Blocked domain patterns and cloud metadata hostnames
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.home$/i,
  /\.corp$/i,
  /\.arpa$/i,
  /^metadata\.google\.internal$/i,
  /\.metadata\.google\.internal$/i,
  /^instance-data$/i,
  /\.instance-data$/i,
];

// Explicit cloud metadata and prohibited IP addresses
const RESTRICTED_EXACT_IPS = new Set([
  '169.254.169.254', // AWS, Azure, GCP IMDS
  '169.254.169.253', // AWS Internal DNS
  '100.100.100.200', // Alibaba Cloud IMDS
  'fd00:ec2::254',   // AWS IPv6 IMDS
  '0.0.0.0',
]);

/**
 * Checks whether an IP address is private, loopback, link-local, reserved,
 * cloud metadata, or otherwise restricted.
 *
 * @param {string} ipStr
 * @param {object} [options]
 * @param {boolean} [options.allowLoopback] - For controlled testing only
 * @returns {{ blocked: boolean, reason?: string, ip?: string }}
 */
export function isIpBlocked(ipStr, options = {}) {
  if (!ipStr || typeof ipStr !== 'string') {
    return { blocked: true, reason: 'Missing or invalid IP address' };
  }

  const clean = ipStr.replace(/^\[|\]$/g, '').trim();
  if (!ipaddr.isValid(clean)) {
    return { blocked: true, reason: 'Invalid IP address syntax' };
  }

  let addr;
  try {
    addr = ipaddr.parse(clean);
  } catch {
    return { blocked: true, reason: 'Unable to parse IP address' };
  }

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }

  const normalized = addr.toString();
  // Cloud metadata is strictly forbidden under all circumstances
  if (RESTRICTED_EXACT_IPS.has(normalized)) {
    return { blocked: true, reason: 'Cloud metadata IP address is prohibited' };
  }

  const range = addr.range();

  if (options.allowLoopback && range === 'loopback') {
    return { blocked: false, ip: normalized };
  }

  // Safe public addresses must strictly be 'unicast'
  if (range !== 'unicast') {
    return { blocked: true, reason: `IP falls in restricted range: ${range}` };
  }

  return { blocked: false, ip: normalized };
}

/**
 * Checks if a hostname matches known private, local, or metadata host patterns.
 *
 * @param {string} hostname
 * @param {object} [options]
 * @param {boolean} [options.allowLoopback]
 * @returns {boolean}
 */
export function isHostnameBlocked(hostname, options = {}) {
  if (!hostname || typeof hostname !== 'string') return true;
  const lower = hostname.toLowerCase().trim();

  if (options.allowLoopback && (lower === 'localhost' || lower === '127.0.0.1')) {
    return false;
  }

  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Validates a target URL:
 * - Must be valid HTTP or HTTPS
 * - No embedded credentials
 * - Hostname/IP must not point to loopback, private, link-local, metadata, or reserved networks
 * - Performs DNS resolution and verifies all resolved IP addresses
 *
 * @param {string} inputUrl
 * @param {object} [options]
 * @param {boolean} [options.allowLoopback]
 * @returns {Promise<{
 *   isValid: boolean,
 *   error?: string,
 *   code?: string,
 *   url?: string,
 *   hostname?: string,
 *   protocol?: string,
 *   resolvedIps?: string[],
 *   primaryIp?: string
 * }>}
 */
export async function validateUrl(inputUrl, options = {}) {
  if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
    return {
      isValid: false,
      error: 'URL is required and must be a non-empty string',
      code: 'MISSING_URL',
    };
  }

  const trimmed = inputUrl.trim();
  if (trimmed.length > 2048) {
    return {
      isValid: false,
      error: 'URL exceeds maximum length of 2048 characters',
      code: 'URL_TOO_LONG',
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      error: 'Malformed or invalid URL syntax',
      code: 'INVALID_URL',
    };
  }

  // Enforce HTTP / HTTPS protocol only
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Unsupported protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are allowed.`,
      code: 'UNSUPPORTED_PROTOCOL',
    };
  }

  // Reject embedded username / password
  if (parsedUrl.username || parsedUrl.password) {
    return {
      isValid: false,
      error: 'URLs containing embedded credentials are not allowed',
      code: 'CREDENTIALS_NOT_ALLOWED',
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname) {
    return {
      isValid: false,
      error: 'URL must contain a valid hostname',
      code: 'INVALID_HOSTNAME',
    };
  }

  // Reject local/internal hostnames
  if (isHostnameBlocked(hostname, options)) {
    return {
      isValid: false,
      error: `Access to local or private hostname "${hostname}" is prohibited`,
      code: 'BLOCKED_HOSTNAME',
    };
  }

  const cleanHost = hostname.replace(/^\[|\]$/g, '');

  // If host is a direct IP address
  if (ipaddr.isValid(cleanHost)) {
    const ipCheck = isIpBlocked(cleanHost, options);
    if (ipCheck.blocked) {
      return {
        isValid: false,
        error: `Target IP is restricted: ${ipCheck.reason}`,
        code: 'RESTRICTED_IP',
      };
    }

    return {
      isValid: true,
      url: parsedUrl.href,
      hostname,
      protocol: parsedUrl.protocol,
      resolvedIps: [cleanHost],
      primaryIp: cleanHost,
    };
  }

  // Resolve hostname through DNS
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return {
        isValid: false,
        error: `No IP addresses found for hostname: ${hostname}`,
        code: 'DNS_NO_RECORDS',
      };
    }

    const resolvedIps = [];
    for (const record of records) {
      const check = isIpBlocked(record.address, options);
      if (check.blocked) {
        return {
          isValid: false,
          error: `Hostname "${hostname}" resolves to restricted IP ${record.address} (${check.reason})`,
          code: 'RESOLVES_TO_RESTRICTED_IP',
        };
      }
      resolvedIps.push(record.address);
    }

    return {
      isValid: true,
      url: parsedUrl.href,
      hostname,
      protocol: parsedUrl.protocol,
      resolvedIps,
      primaryIp: resolvedIps[0],
    };
  } catch (err) {
    return {
      isValid: false,
      error: `Unable to resolve hostname "${hostname}": ${err.message}`,
      code: 'DNS_RESOLUTION_FAILED',
    };
  }
}
