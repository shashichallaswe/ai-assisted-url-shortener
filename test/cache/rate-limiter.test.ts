import { describe, expect, it, vi } from 'vitest';
import { MemoryRateLimiter } from '../../src/cache/memory-rate-limiter.js';
import { RedisRateLimiter } from '../../src/cache/redis-rate-limiter.js';
import { rateLimitIpDigest } from '../../src/security/rate-limit.js';

describe('MemoryRateLimiter', () => {
  it('allows up to the limit and then denies with retryAfterSeconds', async () => {
    const limiter = new MemoryRateLimiter(() => new Date('2026-08-24T12:00:00.000Z'));

    await expect(limiter.consume('k', 2, 60)).resolves.toEqual({ allowed: true });
    await expect(limiter.consume('k', 2, 60)).resolves.toEqual({ allowed: true });
    await expect(limiter.consume('k', 2, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('recovers after the window elapses', async () => {
    let now = new Date('2026-08-24T12:00:00.000Z');
    const limiter = new MemoryRateLimiter(() => now);

    await limiter.consume('k', 1, 60);
    await expect(limiter.consume('k', 1, 60)).resolves.toMatchObject({ allowed: false });

    now = new Date('2026-08-24T12:01:00.000Z');
    await expect(limiter.consume('k', 1, 60)).resolves.toEqual({ allowed: true });
  });

  it('isolates buckets by key', async () => {
    const limiter = new MemoryRateLimiter(() => new Date('2026-08-24T12:00:00.000Z'));

    await limiter.consume('a', 1, 60);
    await expect(limiter.consume('b', 1, 60)).resolves.toEqual({ allowed: true });
  });
});

describe('RedisRateLimiter', () => {
  it('fails open when Redis throws', async () => {
    const redis = {
      incr: vi.fn().mockRejectedValue(new Error('redis down')),
      expire: vi.fn(),
      ttl: vi.fn(),
    };
    const onError = vi.fn();
    const limiter = new RedisRateLimiter(redis, onError);

    await expect(limiter.consume('k', 1, 60)).resolves.toEqual({ allowed: true });
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('rateLimitIpDigest', () => {
  it('is stable for the same ip and pepper, and does not contain the raw ip', () => {
    const digest = rateLimitIpDigest('203.0.113.9', 'pepper-pepper-pepper');

    expect(digest).toHaveLength(32);
    expect(digest).toBe(rateLimitIpDigest('203.0.113.9', 'pepper-pepper-pepper'));
    expect(digest).not.toBe(rateLimitIpDigest('203.0.113.10', 'pepper-pepper-pepper'));
    expect(digest).not.toContain('203.0.113.9');
  });
});
