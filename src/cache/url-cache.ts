export interface CachedUrl {
  id: string;
  destinationUrl: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

/**
 * Cache-aside for the redirect hot path. A miss is normal. Implementations
 * must not throw: Redis being down degrades latency, never correctness.
 */
export interface UrlCache {
  get(code: string): Promise<CachedUrl | 'negative' | null>;
  set(code: string, value: CachedUrl, ttlSeconds: number): Promise<void>;
  setNegative(code: string, ttlSeconds: number): Promise<void>;
  del(code: string): Promise<void>;
}

export function toCachedUrl(row: {
  id: string;
  destinationUrl: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
}): CachedUrl {
  return {
    id: row.id,
    destinationUrl: row.destinationUrl,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

export function fromCachedUrl(entry: CachedUrl): {
  destinationUrl: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
} {
  return {
    destinationUrl: entry.destinationUrl,
    expiresAt: entry.expiresAt === null ? null : new Date(entry.expiresAt),
    deletedAt: entry.deletedAt === null ? null : new Date(entry.deletedAt),
  };
}
