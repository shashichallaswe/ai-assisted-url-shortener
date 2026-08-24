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
