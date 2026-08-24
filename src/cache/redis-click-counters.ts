import type { Redis } from 'ioredis';
import { utcDay } from '../lib/ip-hash.js';
import type { ClickCounters } from './click-counters.js';

const TOTAL_TTL_SECONDS = 24 * 60 * 60;
const DAY_TTL_SECONDS = 48 * 60 * 60;

export class RedisClickCounters implements ClickCounters {
  constructor(
    private readonly redis: Redis,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async increment(code: string, at: Date): Promise<void> {
    const totalKey = `clicks:total:v1:${code}`;
    const dayKey = `clicks:day:v1:${code}:${utcDay(at)}`;
    try {
      const [totalCount, dayCount] = await Promise.all([
        this.redis.incr(totalKey),
        this.redis.incr(dayKey),
      ]);
      if (totalCount === 1) {
        await this.redis.expire(totalKey, TOTAL_TTL_SECONDS);
      }
      if (dayCount === 1) {
        await this.redis.expire(dayKey, DAY_TTL_SECONDS);
      }
    } catch (error) {
      this.onError(error);
    }
  }

  async total(code: string): Promise<number> {
    try {
      const raw = await this.redis.get(`clicks:total:v1:${code}`);
      return raw === null ? 0 : Number(raw);
    } catch (error) {
      this.onError(error);
      return 0;
    }
  }
}
