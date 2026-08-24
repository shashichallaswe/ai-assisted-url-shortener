import type { Pool, PoolClient } from 'pg';

export interface DurableClick {
  urlId: string;
  clickedAt: Date;
  ipHash: Buffer;
  userAgent: string | null;
  referrer: string | null;
}

export async function insertClickEvents(
  db: Pool | PoolClient,
  events: readonly DurableClick[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const urlIds: string[] = [];
  const clickedAt: Date[] = [];
  const ipHashes: Buffer[] = [];
  const userAgents: Array<string | null> = [];
  const referrers: Array<string | null> = [];

  for (const event of events) {
    urlIds.push(event.urlId);
    clickedAt.push(event.clickedAt);
    ipHashes.push(event.ipHash);
    userAgents.push(event.userAgent);
    referrers.push(event.referrer);
  }

  await db.query(
    `insert into click_events (url_id, clicked_at, ip_hash, user_agent, referrer)
     select * from unnest($1::bigint[], $2::timestamptz[], $3::bytea[], $4::text[], $5::text[])`,
    [urlIds, clickedAt, ipHashes, userAgents, referrers],
  );
}

/** Windowed per-day rollup. Aggregation stays in SQL. */
export const CLICK_STATS_BY_DAY_SQL = `
select (timezone('UTC', clicked_at))::date::text as date, count(*)::int as clicks
  from click_events
 where url_id = $1
   and clicked_at >= $2
 group by 1
 order by 1
`;

export const CLICK_STATS_SUMMARY_SQL = `
select count(*)::int as total_clicks, max(clicked_at) as last_clicked_at
  from click_events
 where url_id = $1
   and clicked_at >= $2
`;

export interface ClickDayCount {
  date: string;
  clicks: number;
}

export interface ClickStatsRow {
  totalClicks: number;
  lastClickedAt: Date | null;
  clicksByDay: ClickDayCount[];
}

export async function selectClickStats(
  db: Pool | PoolClient,
  urlId: string,
  since: Date,
): Promise<ClickStatsRow> {
  const [summary, byDay] = await Promise.all([
    db.query<{ total_clicks: number; last_clicked_at: Date | null }>(CLICK_STATS_SUMMARY_SQL, [
      urlId,
      since,
    ]),
    db.query<{ date: string; clicks: number }>(CLICK_STATS_BY_DAY_SQL, [urlId, since]),
  ]);

  return {
    totalClicks: summary.rows[0]?.total_clicks ?? 0,
    lastClickedAt: summary.rows[0]?.last_clicked_at ?? null,
    clicksByDay: byDay.rows.map((row) => ({ date: row.date, clicks: row.clicks })),
  };
}
