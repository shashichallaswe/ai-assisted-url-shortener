import { STATS_DEFAULT_DAYS, STATS_MAX_DAYS } from '../lib/constants.js';
import { HttpError, notFound } from '../lib/http-error.js';
import { isReservedCode, isWellFormedCode } from '../lib/codes.js';
import { selectClickStats } from '../repos/click-events.js';
import { findUrlByCode, type UrlRecord } from '../repos/urls.js';
import type { Pool } from 'pg';

export interface UrlStats {
  code: string;
  totalClicks: number;
  lastClickedAt: string | null;
  clicksByDay: { date: string; clicks: number }[];
}

export function parseStatsDays(raw: string | undefined): number {
  if (raw === undefined) {
    return STATS_DEFAULT_DAYS;
  }
  if (!/^[0-9]+$/u.test(raw)) {
    throw new HttpError(
      400,
      'validation_error',
      `days must be an integer from 1 to ${String(STATS_MAX_DAYS)}`,
      [{ field: 'days', message: `must be an integer from 1 to ${String(STATS_MAX_DAYS)}` }],
    );
  }
  const days = Number(raw);
  if (days < 1 || days > STATS_MAX_DAYS) {
    throw new HttpError(
      400,
      'validation_error',
      `days must be an integer from 1 to ${String(STATS_MAX_DAYS)}`,
      [{ field: 'days', message: `must be an integer from 1 to ${String(STATS_MAX_DAYS)}` }],
    );
  }
  return days;
}

/** Inclusive UTC window: today minus (days - 1) at 00:00 UTC. */
export function statsWindowStart(days: number, now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export async function getUrlStats(
  deps: { pool: Pool; clock: () => Date; findByCode?: typeof findUrlByCode },
  code: string,
  days: number,
): Promise<UrlStats> {
  if (isReservedCode(code) || !isWellFormedCode(code)) {
    throw notFound();
  }
  const findByCode = deps.findByCode ?? findUrlByCode;
  const row: UrlRecord | null = await findByCode(deps.pool, code);
  if (row === null || row.deletedAt !== null) {
    throw notFound();
  }
  const since = statsWindowStart(days, deps.clock());
  const stats = await selectClickStats(deps.pool, row.id, since);
  return {
    code: row.code,
    totalClicks: stats.totalClicks,
    lastClickedAt: stats.lastClickedAt === null ? null : stats.lastClickedAt.toISOString(),
    clicksByDay: stats.clicksByDay,
  };
}
