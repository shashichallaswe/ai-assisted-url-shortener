import type { Redis } from 'ioredis';
import type { RateLimitDecision, RateLimiter } from '../security/rate-limit.js';

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Pick<Redis, 'incr' | 'expire' | 'ttl'>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSeconds);
      }
      if (count > limit) {
        const ttl = await this.redis.ttl(key);
        return { allowed: false, retryAfterSeconds: Math.max(1, ttl) };
      }
      return { allowed: true };
    } catch (error) {
      this.onError(error);
      return { allowed: true };
    }
  }
}
