import type { RateLimitDecision, RateLimiter } from '../security/rate-limit.js';
import { remainingWindowSeconds, rateLimitWindowStart } from '../security/rate-limit.js';

interface Bucket {
  count: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const bucketKey = `${key}:${String(rateLimitWindowStart(this.clock(), windowSeconds))}`;
    const bucket = this.buckets.get(bucketKey) ?? { count: 0 };
    if (bucket.count >= limit) {
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: remainingWindowSeconds(this.clock(), windowSeconds),
      });
    }
    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);
    return Promise.resolve({ allowed: true });
  }
}
