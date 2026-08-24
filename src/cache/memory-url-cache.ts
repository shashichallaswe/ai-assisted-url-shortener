import { NEGATIVE_CACHE_TTL_SECONDS } from '../lib/cache-ttl.js';
import type { CachedUrl, UrlCache } from './url-cache.js';

interface LiveEntry {
  value: CachedUrl;
  expiresAtMs: number;
}

/**
 * Process-local cache used in tests and as a fallback. Honors TTL so tests
 * can prove that a stale live entry is treated as a miss.
 */
export class MemoryUrlCache implements UrlCache {
  readonly live = new Map<string, LiveEntry>();
  readonly negative = new Map<string, number>();
  gets = 0;
  hits = 0;
  negativeHits = 0;
  misses = 0;
  sets = 0;
  negativeSets = 0;
  deletes = 0;

  get(code: string): Promise<CachedUrl | 'negative' | null> {
    this.gets += 1;
    const now = Date.now();
    const negativeUntil = this.negative.get(code);
    if (negativeUntil !== undefined) {
      if (negativeUntil > now) {
        this.negativeHits += 1;
        return Promise.resolve('negative');
      }
      this.negative.delete(code);
    }
    const live = this.live.get(code);
    if (live !== undefined) {
      if (live.expiresAtMs > now) {
        this.hits += 1;
        return Promise.resolve(live.value);
      }
      this.live.delete(code);
    }
    this.misses += 1;
    return Promise.resolve(null);
  }

  set(code: string, value: CachedUrl, ttlSeconds: number): Promise<void> {
    this.sets += 1;
    this.negative.delete(code);
    this.live.set(code, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  setNegative(code: string, ttlSeconds: number = NEGATIVE_CACHE_TTL_SECONDS): Promise<void> {
    this.negativeSets += 1;
    this.live.delete(code);
    this.negative.set(code, Date.now() + ttlSeconds * 1000);
    return Promise.resolve();
  }

  del(code: string): Promise<boolean> {
    this.deletes += 1;
    this.live.delete(code);
    this.negative.delete(code);
    return Promise.resolve(true);
  }
}
