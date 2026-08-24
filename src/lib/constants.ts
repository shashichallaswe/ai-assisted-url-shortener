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
