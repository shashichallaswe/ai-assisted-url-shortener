/** Shared numeric and key constants. Import from here instead of scattering literals. */

export const CLICK_TEXT_LIMIT = 512;
export const MAX_CLICK_QUEUE = 10_000;

/** Lifetime of `clicks:total:v1:*` Redis counters. */
export const CLICK_TOTAL_TTL_SECONDS = 24 * 60 * 60;

/** Lifetime of `clicks:day:v1:*` Redis counters. */
export const CLICK_DAY_TTL_SECONDS = 48 * 60 * 60;

export function clickTotalKey(code: string): string {
  return `clicks:total:v1:${code}`;
}

export function clickDayKey(code: string, day: string): string {
  return `clicks:day:v1:${code}:${day}`;
}

/** Default stats window: last 30 UTC days including today. */
export const STATS_DEFAULT_DAYS = 30;

/** Upper bound on the `days` query parameter. */
export const STATS_MAX_DAYS = 90;

/** Default create cap: 30 POSTs per API key per minute. */
export const RATE_LIMIT_CREATE_MAX = 30;

/** Default redirect cap: 120 GETs per hashed IP per minute. */
export const RATE_LIMIT_REDIRECT_MAX = 120;

/** Fixed window length for both rate-limit buckets. */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * When `buildApp` is not given explicit limits (almost always tests), use a
 * ceiling the suite cannot trip. Production always injects env values from
 * `server.ts`.
 */
export const RATE_LIMIT_IN_PROCESS_MAX = 10_000;

export const RATE_LIMIT_IN_PROCESS_IP_PEPPER = 'test-rate-limit-pepper';
