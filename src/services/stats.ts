import { isReservedCode, isWellFormedCode } from '../lib/codes.js';
import { STATS_DEFAULT_DAYS, STATS_MAX_DAYS } from '../lib/constants.js';
import { HttpError, notFound } from '../lib/errors/http-error.js';
import type { ClickStats } from '../repos/click-events.js';
import type { UrlRecord } from '../repos/urls.js';

export interface UrlStats {
  code: string;
  totalClicks: number;
  lastClickedAt: string | null;
  clicksByDay: { date: string; clicks: number }[];
}

export interface UrlStatsDeps {
  clock: () => Date;
  findByCode: (code: string) => Promise<UrlRecord | null>;
  loadStats: (urlId: string, since: Date) => Promise<ClickStats>;
}

export function parseStatsDays(raw: string | undefined): number {
  if (raw === undefined) {
    return STATS_DEFAULT_DAYS;
  }
  const days = /^[0-9]+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > STATS_MAX_DAYS) {
    throw invalidDays();
  }
  return days;
}

/** Start of the window: midnight UTC, `days` days ago inclusive of today. */
export function statsWindowStart(days: number, now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export async function getUrlStats(
  deps: UrlStatsDeps,
  code: string,
  days: number,
): Promise<UrlStats> {
  if (isReservedCode(code) || !isWellFormedCode(code)) {
    throw notFound();
  }
  const row = await deps.findByCode(code);
  if (row === null || row.deletedAt !== null) {
    throw notFound();
  }

  const stats = await deps.loadStats(row.id, statsWindowStart(days, deps.clock()));
  return {
    code: row.code,
    totalClicks: stats.totalClicks,
    lastClickedAt: stats.lastClickedAt === null ? null : stats.lastClickedAt.toISOString(),
    clicksByDay: stats.clicksByDay,
  };
}

function invalidDays(): HttpError {
  const message = `must be an integer from 1 to ${String(STATS_MAX_DAYS)}`;
  return new HttpError(400, 'validation_error', `days ${message}`, [{ field: 'days', message }]);
}
