import { isIP } from 'node:net';

const MAX_LENGTH = 2048;

export type DestinationInspection =
  | { ok: true; href: string }
  | { ok: false; reason: string };

/**
 * Structural destination checks only. Never fetches, never resolves DNS:
 * looking up a caller-supplied hostname would be the SSRF we are preventing.
 */
export function inspectDestination(raw: string): DestinationInspection {
  if (raw !== raw.trim() || raw.length === 0) {
    return { ok: false, reason: 'must be a valid absolute URL' };
  }

  if (raw.length > MAX_LENGTH) {
    return { ok: false, reason: 'must be at most 2048 characters' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'must be a valid absolute URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'must be an https URL' };
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'must not include credentials' };
  }

  const hostname = stripTrailingDots(unwrapIpv6(parsed.hostname)).toLowerCase();
  if (hostname.length === 0) {
    return { ok: false, reason: 'must be a valid absolute URL' };
  }

  if (isLocalHostname(hostname) || isBlockedAddress(hostname)) {
    return { ok: false, reason: 'must not target a private or local address' };
  }

  if (parsed.href.length > MAX_LENGTH) {
    return { ok: false, reason: 'must be at most 2048 characters' };
  }

  return { ok: true, href: parsed.href };
}

function unwrapIpv6(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function stripTrailingDots(hostname: string): string {
  return hostname.replace(/\.+$/u, '');
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'localhost.localdomain'
  );
}

function isBlockedAddress(hostname: string): boolean {
  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null) {
    return isPrivateIPv4(ipv4);
  }

  if (isIP(hostname) === 6) {
    return isPrivateIPv6(hostname);
  }

  return false;
}

/**
 * Accepts dotted-decimal, inet_aton shorthand (127.1), and 32-bit dword form.
 * Rejects leading zeros so octal forms cannot slip through as decimal.
 */
function parseIPv4(hostname: string): number | null {
  if (/^\d+$/u.test(hostname)) {
    const value = Number(hostname);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      return null;
    }
    return value >>> 0;
  }

  const labels = hostname.split('.');
  if (labels.length < 2 || labels.length > 4) {
    return null;
  }

  const octets: number[] = [];
  for (const label of labels) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(label)) {
      return null;
    }
    const octet = Number(label);
    if (octet > 255) {
      return null;
    }
    octets.push(octet);
  }

  const [first, second, third, fourth] = octets;
  if (first === undefined || second === undefined) {
    return null;
  }

  if (octets.length === 4 && third !== undefined && fourth !== undefined) {
    return ((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0;
  }

  if (octets.length === 3 && third !== undefined) {
    if (third > 0xffff) {
      return null;
    }
    return ((first << 24) | (second << 16) | third) >>> 0;
  }

  if (second > 0xff_ffff) {
    return null;
  }
  return ((first << 24) | second) >>> 0;
}

function isPrivateIPv4(address: number): boolean {
  const octetA = (address >>> 24) & 0xff;
  const octetB = (address >>> 16) & 0xff;

  if (octetA === 0 || octetA === 10 || octetA === 127) {
    return true;
  }
  if (octetA === 169 && octetB === 254) {
    return true;
  }
  if (octetA === 172 && octetB >= 16 && octetB <= 31) {
    return true;
  }
  if (octetA === 192 && octetB === 168) {
    return true;
  }
  // Shared CGNAT space. Not RFC1918, but not a public destination either.
  if (octetA === 100 && octetB >= 64 && octetB <= 127) {
    return true;
  }
  return false;
}

function isPrivateIPv6(hostname: string): boolean {
  const lowered = hostname.toLowerCase();

  if (lowered === '::' || lowered === '::1') {
    return true;
  }

  const mapped = extractMappedIPv4(lowered);
  if (mapped !== null) {
    return isPrivateIPv4(mapped);
  }

  const first = firstHextet(lowered);
  if (first === null) {
    return false;
  }

  // fe80::/10 link-local
  if (first >= 0xfe80 && first <= 0xfebf) {
    return true;
  }

  // fc00::/7 unique-local
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }

  return false;
}

function firstHextet(hostname: string): number | null {
  const first = hostname.split(':', 1)[0];
  if (first === undefined || first.length === 0) {
    return null;
  }
  const value = Number.parseInt(first, 16);
  return Number.isNaN(value) ? null : value;
}

function extractMappedIPv4(hostname: string): number | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(hostname);
  const dottedHost = dotted?.[1];
  if (dottedHost !== undefined) {
    return parseIPv4(dottedHost);
  }

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(hostname);
  const high = hex?.[1];
  const low = hex?.[2];
  if (high !== undefined && low !== undefined) {
    return ((Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16)) >>> 0;
  }

  return null;
}
