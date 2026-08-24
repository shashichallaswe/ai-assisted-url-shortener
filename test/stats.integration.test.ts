import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickCapture } from '../src/analytics/click-capture.js';
import { buildApp } from '../src/app.js';
import { MemoryClickCounters } from '../src/cache/memory-click-counters.js';
import { migrate } from '../src/db/migrate.js';
import { CLICK_STATS_BY_DAY_SQL, insertClickEvents } from '../src/repos/click-events.js';
import { insertApiKey } from './helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from './helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; stats integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';

interface StatsBody {
  code: string;
  totalClicks: number;
  lastClickedAt: string | null;
  clicksByDay: { date: string; clicks: number }[];
}

describe.skipIf(!databaseAvailable)('GET /api/v1/urls/:code/stats', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let rawKey: string;
  let clicks: ClickCapture;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
    clicks = new ClickCapture({
      salt: 'test-click-ip-salt',
      clock: () => new Date(),
      counters: new MemoryClickCounters(),
      insert: (rows) => insertClickEvents(pool, rows),
      onError: () => undefined,
    });
    app = await buildApp({ logger: false, pool, baseUrl: BASE_URL, clicks });
    await app.ready();
    ({ rawKey } = await insertApiKey(pool));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createLink(): Promise<{ code: string; urlId: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { originalUrl: 'https://example.com/stats' },
    });
    expect(created.statusCode).toBe(201);
    const code = created.json<{ code: string }>().code;
    const { rows } = await pool.query<{ id: string }>('select id from urls where code = $1', [
      code,
    ]);
    const urlId = rows[0]?.id;
    if (urlId === undefined) {
      throw new Error('expected persisted url');
    }
    return { code, urlId };
  }

  async function stats(code: string, headers: Record<string, string> = {}, query = '') {
    return app.inject({
      method: 'GET',
      url: `/api/v1/urls/${code}/stats${query}`,
      headers,
    });
  }

  it('returns 401 without a bearer token', async () => {
    const { code } = await createLink();
    const response = await stats(code);
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for a revoked key', async () => {
    const { code } = await createLink();
    const { rawKey: revokedKey } = await insertApiKey(pool, { revoked: true });
    const response = await stats(code, { authorization: `Bearer ${revokedKey}` });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown code', async () => {
    const response = await stats('NoSuch1', { authorization: `Bearer ${rawKey}` });
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when days is outside the documented window', async () => {
    const { code } = await createLink();
    const response = await stats(code, { authorization: `Bearer ${rawKey}` }, '?days=365');
    expect(response.statusCode).toBe(400);
  });

  it('bounds the window, so a click older than days is excluded', async () => {
    const { code, urlId } = await createLink();
    await insertClickEvents(pool, [
      {
        urlId,
        clickedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        ipHash: Buffer.alloc(32),
        userAgent: null,
        referrer: null,
      },
    ]);

    const wide = await stats(code, { authorization: `Bearer ${rawKey}` });
    expect(wide.json<StatsBody>().totalClicks).toBe(1);

    const narrow = await stats(code, { authorization: `Bearer ${rawKey}` }, '?days=1');
    expect(narrow.json<StatsBody>().totalClicks).toBe(0);
  });

  it('returns totalClicks 0 and an empty series when the link has no clicks', async () => {
    const { code } = await createLink();
    const response = await stats(code, { authorization: `Bearer ${rawKey}` });
    expect(response.statusCode).toBe(200);
    expect(response.json<StatsBody>()).toEqual({
      code,
      totalClicks: 0,
      lastClickedAt: null,
      clicksByDay: [],
    });
  });

  it('counts a known number of redirects', async () => {
    const { code } = await createLink();
    for (let i = 0; i < 3; i += 1) {
      const redirect = await app.inject({ method: 'GET', url: `/${code}` });
      expect(redirect.statusCode).toBe(302);
    }
    await clicks.flush();

    const response = await stats(code, { authorization: `Bearer ${rawKey}` });
    expect(response.statusCode).toBe(200);
    const body = response.json<StatsBody>();
    expect(body.totalClicks).toBe(3);
    expect(body.lastClickedAt).not.toBeNull();
    expect(body.clicksByDay.reduce((sum, day) => sum + day.clicks, 0)).toBe(3);
  });

  it('aggregates per-day counts with a SQL GROUP BY, not in application memory', () => {
    expect(CLICK_STATS_BY_DAY_SQL).toMatch(/group by/i);
  });

  it('uses the (url_id, clicked_at) index for the windowed aggregate', async () => {
    const { urlId } = await createLink();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `explain ${CLICK_STATS_BY_DAY_SQL}`,
        [urlId, new Date('2020-01-01T00:00:00.000Z')],
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/click_events_url_id_clicked_at_idx/i);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
