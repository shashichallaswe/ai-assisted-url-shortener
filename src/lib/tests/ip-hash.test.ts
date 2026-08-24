import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashIp } from '../ip-hash.js';

const salt = 'test-click-salt-16';
const ip = '203.0.113.50';

describe('hashIp', () => {
  it('returns a 32-byte SHA-256 digest that does not contain the raw IP', () => {
    const digest = hashIp(ip, salt, new Date('2026-08-23T12:00:00.000Z'));

    expect(digest).toHaveLength(32);
    expect(digest.includes(Buffer.from(ip, 'utf8'))).toBe(false);
    expect(digest.toString('hex')).not.toContain('203');
  });

  it('is stable for the same IP, salt, and UTC day', () => {
    const morning = hashIp(ip, salt, new Date('2026-08-23T01:00:00.000Z'));
    const evening = hashIp(ip, salt, new Date('2026-08-23T23:59:59.000Z'));
    const expected = createHash('sha256').update(`${salt}:2026-08-23:${ip}`, 'utf8').digest();

    expect(morning.equals(evening)).toBe(true);
    expect(morning.equals(expected)).toBe(true);
  });

  it('changes when the UTC day rolls, so a visitor cannot be correlated across days', () => {
    const sunday = hashIp(ip, salt, new Date('2026-08-23T23:00:00.000Z'));
    const monday = hashIp(ip, salt, new Date('2026-08-24T01:00:00.000Z'));

    expect(sunday.equals(monday)).toBe(false);
  });
});
