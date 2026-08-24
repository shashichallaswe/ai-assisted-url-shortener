import { createHash } from 'node:crypto';

/**
 * SHA-256 of `salt:UTC-date:ip`. The date fragment rotates the hash daily so a
 * stored digest cannot correlate a visitor across days. The raw IP is not
 * returned and must not be logged by callers.
 */
export function hashIp(ip: string, salt: string, at: Date): Buffer {
  const day = at.toISOString().slice(0, 10);
  return createHash('sha256').update(`${salt}:${day}:${ip}`, 'utf8').digest();
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
