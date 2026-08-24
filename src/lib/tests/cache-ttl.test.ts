import { describe, expect, it } from 'vitest';
import {
  MAX_CACHE_TTL_SECONDS,
  NEGATIVE_CACHE_TTL_SECONDS,
  cacheTtlSeconds,
} from '../cache-ttl.js';

describe('cacheTtlSeconds', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  it('caps a link with no expiry at one hour', () => {
    expect(cacheTtlSeconds(null, now)).toBe(MAX_CACHE_TTL_SECONDS);
  });

  it('caps remaining lifetime when expiry is more than an hour away', () => {
    const expiresAt = new Date('2026-08-23T15:00:00.000Z');
    expect(cacheTtlSeconds(expiresAt, now)).toBe(MAX_CACHE_TTL_SECONDS);
  });

  it('uses remaining seconds when expiry is sooner than the cap', () => {
    const expiresAt = new Date('2026-08-23T12:05:00.000Z');
    expect(cacheTtlSeconds(expiresAt, now)).toBe(300);
  });

  it('returns null when the link has already expired, so it is not cached as live', () => {
    const expiresAt = new Date('2026-08-23T11:59:00.000Z');
    expect(cacheTtlSeconds(expiresAt, now)).toBeNull();
  });

  it('keeps the negative-lookup TTL at 60 seconds', () => {
    expect(NEGATIVE_CACHE_TTL_SECONDS).toBe(60);
  });
});
