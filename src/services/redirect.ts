import { fromCachedUrl, toCachedUrl, type UrlCache } from '../cache/url-cache.js';
import { cacheTtlSeconds, NEGATIVE_CACHE_TTL_SECONDS } from '../lib/cache-ttl.js';
import { isReservedCode, isWellFormedCode } from '../lib/codes.js';
import { notFound } from '../lib/http-error.js';
import { redirectDecision } from '../lib/redirect-decision.js';
import { publicShortUrl } from '../lib/public-url.js';
import type { UrlRecord } from '../repos/urls.js';
import { inspectDestination } from '../security/url-policy.js';

export interface ResolveRedirectDeps {
  clock: () => Date;
  cache: UrlCache;
  findByCode: (code: string) => Promise<UrlRecord | null>;
}

export interface RedirectHit {
  destinationUrl: string;
  urlId: string;
  code: string;
}

export async function resolveRedirect(
  deps: ResolveRedirectDeps,
  code: string,
): Promise<RedirectHit> {
  if (isReservedCode(code) || !isWellFormedCode(code)) {
    throw notFound();
  }

  const now = deps.clock();
  const cached = await deps.cache.get(code);
  if (cached === 'negative') {
    throw notFound();
  }
  if (cached !== null) {
    return finishRedirect(cached.id, code, fromCachedUrl(cached), now);
  }

  const row = await deps.findByCode(code);
  if (row === null) {
    await deps.cache.setNegative(code, NEGATIVE_CACHE_TTL_SECONDS);
    throw notFound();
  }

  const hit = finishRedirect(row.id, code, row, now);

  const ttl = cacheTtlSeconds(row.expiresAt, now);
  if (ttl !== null) {
    await deps.cache.set(code, toCachedUrl(row), ttl);
  }
  return hit;
}

function finishRedirect(
  urlId: string,
  code: string,
  candidate: { destinationUrl: string; expiresAt: Date | null; deletedAt: Date | null },
  now: Date,
): RedirectHit {
  const decision = redirectDecision(candidate, now);
  if (!decision.ok) {
    throw notFound();
  }
  const inspected = inspectDestination(decision.destinationUrl);
  if (!inspected.ok) {
    throw notFound();
  }
  return { destinationUrl: inspected.href, urlId, code };
}

export interface UrlMetadata {
  code: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
  createdAt: string;
}

export async function getUrlMetadata(
  deps: { baseUrl: string; findByCode: (code: string) => Promise<UrlRecord | null> },
  code: string,
): Promise<UrlMetadata> {
  if (isReservedCode(code) || !isWellFormedCode(code)) {
    throw notFound();
  }
  const row = await deps.findByCode(code);
  if (row === null || row.deletedAt !== null) {
    throw notFound();
  }
  return {
    code: row.code,
    shortUrl: publicShortUrl(deps.baseUrl, row.code),
    originalUrl: row.destinationUrl,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function invalidateUrlCache(cache: UrlCache, code: string): Promise<void> {
  await cache.del(code);
}
