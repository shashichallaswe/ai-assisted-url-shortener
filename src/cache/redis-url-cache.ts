import { Redis } from 'ioredis';
import { NEGATIVE_CACHE_TTL_SECONDS } from '../lib/cache-ttl.js';
import type { CachedUrl, UrlCache } from './url-cache.js';

const NEGATIVE_SENTINEL = '__missing__';

function liveKey(code: string): string {
  return `url:v1:${code}`;
}

/**
 * Redis cache-aside. Every method swallows connection errors: losing Redis
 * must degrade to a Postgres lookup, never change the HTTP answer.
 */
export class RedisUrlCache implements UrlCache {
  constructor(
    private readonly redis: Redis,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async get(code: string): Promise<CachedUrl | 'negative' | null> {
    try {
      const raw = await this.redis.get(liveKey(code));
      if (raw === null) {
        return null;
      }
      if (raw === NEGATIVE_SENTINEL) {
        return 'negative';
      }
      return JSON.parse(raw) as CachedUrl;
    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  async set(code: string, value: CachedUrl, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(liveKey(code), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.onError(error);
    }
  }

  async setNegative(code: string, ttlSeconds: number = NEGATIVE_CACHE_TTL_SECONDS): Promise<void> {
    try {
      await this.redis.set(liveKey(code), NEGATIVE_SENTINEL, 'EX', ttlSeconds);
    } catch (error) {
      this.onError(error);
    }
  }

  async del(code: string): Promise<boolean> {
    try {
      await this.redis.del(liveKey(code));
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }
}

export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}
