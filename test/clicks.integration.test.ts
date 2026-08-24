import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickCapture } from '../src/analytics/click-capture.js';
import { MemoryClickCounters } from '../src/cache/memory-click-counters.js';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { hashIp } from '../src/lib/ip-hash.js';
import { insertClickEvents, type DurableClick } from '../src/repos/click-events.js';
import { insertApiKey } from './helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from './helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; click integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';
const SALT = 'test-click-ip-salt';
const VISITOR_IP = '203.0.113.50';

describe.skipIf(!databaseAvailable)('click capture on redirect', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let rawKey: string;
  let counters: MemoryClickCounters;
  let clicks: ClickCapture;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
    counters = new MemoryClickCounters();
    clicks = new ClickCapture({
      salt: SALT,
      clock: () => new Date(),
      counters,
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
      payload: { originalUrl: 'https://example.com/clicked' },
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

  it('records a hashed click and increments the fast counter on 302', async () => {
    const { code, urlId } = await createLink();
    const at = new Date();
    const response = await app.inject({
      method: 'GET',
      url: `/${code}`,
      remoteAddress: VISITOR_IP,
      headers: {
        'user-agent': 'Mozilla/5.0 test-agent',
        referer: 'https://news.example/story',
      },
    });
    expect(response.statusCode).toBe(302);
    await clicks.flush();

    expect(counters.total(code)).toBe(1);
    const { rows } = await pool.query<{
      url_id: string;
      ip_hash: Buffer;
      user_agent: string | null;
      referrer: string | null;
    }>('select url_id, ip_hash, user_agent, referrer from click_events where url_id = $1', [urlId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_agent).toBe('Mozilla/5.0 test-agent');
    expect(rows[0]?.referrer).toBe('https://news.example/story');
    expect(rows[0]?.ip_hash.equals(hashIp(VISITOR_IP, SALT, at))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(VISITOR_IP);
  });

  it('does not record a click on 404', async () => {
    const before = await pool.query<{ n: string }>('select count(*)::text as n from click_events');
    await pool.query(`delete from urls where code = $1`, ['NoHit01']);
    const response = await app.inject({
      method: 'GET',
      url: '/NoHit01',
      remoteAddress: VISITOR_IP,
    });
    expect(response.statusCode).toBe(404);
    await clicks.flush();
    const after = await pool.query<{ n: string }>('select count(*)::text as n from click_events');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('still returns 302 when the durable write fails', async () => {
    const failing = new ClickCapture({
      salt: SALT,
      clock: () => new Date(),
      counters: new MemoryClickCounters(),
      insert: (_rows: DurableClick[]) => Promise.reject(new Error('postgres unavailable')),
      onError: () => undefined,
    });
    const isolated = await buildApp({ logger: false, pool, baseUrl: BASE_URL, clicks: failing });
    await isolated.ready();
    try {
      const created = await isolated.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers: { authorization: `Bearer ${rawKey}` },
        payload: { originalUrl: 'https://example.com/fail-open' },
      });
      const code = created.json<{ code: string }>().code;
      const response = await isolated.inject({ method: 'GET', url: `/${code}` });
      expect(response.statusCode).toBe(302);
      await failing.flush();
    } finally {
      await isolated.close();
    }
  });

  it('has an index on (url_id, clicked_at) for per-link time-range queries', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'click_events'`,
    );
    expect(
      rows.some((row) => /url_id/u.test(row.indexdef) && /clicked_at/u.test(row.indexdef)),
    ).toBe(true);
  });
});
