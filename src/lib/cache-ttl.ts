export const MAX_CACHE_TTL_SECONDS = 3600;
export const NEGATIVE_CACHE_TTL_SECONDS = 60;

/**
 * TTL for a live cache entry. Capped at one hour, and never longer than the
 * link's remaining lifetime, so a cached mapping cannot outlive expiry.
 * Returns null when the link is already expired: callers must not store it
 * as a live entry.
 */
export function cacheTtlSeconds(expiresAt: Date | null, now: Date): number | null {
  if (expiresAt === null) {
    return MAX_CACHE_TTL_SECONDS;
  }

  const remainingSeconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (remainingSeconds <= 0) {
    return null;
  }

  return Math.min(MAX_CACHE_TTL_SECONDS, remainingSeconds);
}