import type { Redis } from 'ioredis';
import {
  CLICK_DAY_TTL_SECONDS,
  CLICK_TOTAL_TTL_SECONDS,
  clickDayKey,
  clickTotalKey,
} from '../lib/constants.js';
import { utcDay } from '../lib/ip-hash.js';
import type { ClickCounters } from './click-counters.js';

export class RedisClickCounters implements ClickCounters {
  constructor(
    private readonly redis: Redis,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async increment(code: string, at: Date): Promise<void> {
    const totalKey = clickTotalKey(code);
    const dayKey = clickDayKey(code, utcDay(at));
    try {
      const [totalCount, dayCount] = await Promise.all([
        this.redis.incr(totalKey),
        this.redis.incr(dayKey),
      ]);
      if (totalCount === 1) {
        await this.redis.expire(totalKey, CLICK_TOTAL_TTL_SECONDS);
      }
      if (dayCount === 1) {
        await this.redis.expire(dayKey, CLICK_DAY_TTL_SECONDS);
      }
    } catch (error) {
      this.onError(error);
    }
  }

  async total(code: string): Promise<number> {
    try {
      const raw = await this.redis.get(clickTotalKey(code));
      return raw === null ? 0 : Number(raw);
    } catch (error) {
      this.onError(error);
      return 0;
    }
  }
}
