const MAX_LENGTH = 128;
const ALLOWED = /^[\w.:-]+$/u;

export function requestIdFromHeaders(headers: {
  [key: string]: string | string[] | undefined;
}): string {
  const raw = headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return crypto.randomUUID();
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH || !ALLOWED.test(trimmed)) {
    return crypto.randomUUID();
  }
  return trimmed;
}
