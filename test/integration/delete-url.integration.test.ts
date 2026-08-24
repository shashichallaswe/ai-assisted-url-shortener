import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryUrlCache } from '../../src/cache/memory-url-cache.js';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { insertClickEvents } from '../../src/repos/click-events.js';
import { insertApiKey } from '../helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from '../helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; delete-URL integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';
const VALID_URL = 'https://example.com/takedown';

describe.skipIf(!databaseAvailable)('DELETE /api/v1/urls/:code', () => {
  let pool: Pool;
  let cache: MemoryUrlCache;
  let app: FastifyInstance;
  let rawKey: string;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
    cache = new MemoryUrlCache();
    app = await buildApp({ logger: false, pool, baseUrl: BASE_URL, cache });
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
      payload: { originalUrl: VALID_URL },
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

  it('returns 401 without a bearer token', async () => {
    const { code } = await createLink();
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/urls/${code}` });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown code', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/urls/NoSuch1',
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 204 and sets deleted_at', async () => {
    const { code } = await createLink();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/urls/${code}`,
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      'select deleted_at from urls where code = $1',
      [code],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it('is idempotent: a second delete is still 204', async () => {
    const { code } = await createLink();
    const headers = { authorization: `Bearer ${rawKey}` };
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/urls/${code}`, headers })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/urls/${code}`, headers })).statusCode,
    ).toBe(204);
  });

  it('makes the next redirect 404 and removes the cache entry rather than waiting for TTL', async () => {
    const { code } = await createLink();
    expect((await app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(302);
    expect(cache.live.has(code)).toBe(true);

    const deletesBefore = cache.deletes;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/urls/${code}`,
          headers: { authorization: `Bearer ${rawKey}` },
        })
      ).statusCode,
    ).toBe(204);

    expect(cache.deletes).toBeGreaterThan(deletesBefore);
    expect(cache.live.has(code)).toBe(false);

    const redirect = await app.inject({ method: 'GET', url: `/${code}` });
    expect(redirect.statusCode).toBe(404);
    expect(redirect.headers.location).toBeUndefined();
  });

  it('takes down an aliased link and invalidates its cache the same way', async () => {
    await pool.query(
      `delete from click_events where url_id in (select id from urls where code = $1)`,
      ['take-me'],
    );
    await pool.query(`delete from urls where code = $1`, ['take-me']);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { originalUrl: VALID_URL, customAlias: 'take-me' },
    });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/take-me' })).statusCode).toBe(302);
    expect(cache.live.has('take-me')).toBe(true);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/urls/take-me',
          headers: { authorization: `Bearer ${rawKey}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(cache.live.has('take-me')).toBe(false);

    const redirect = await app.inject({ method: 'GET', url: '/take-me' });
    expect(redirect.statusCode).toBe(404);
  });

  it('keeps click events queryable through stats after deletion', async () => {
    const { code, urlId } = await createLink();
    await insertClickEvents(pool, [
      {
        urlId,
        clickedAt: new Date(),
        ipHash: Buffer.alloc(32),
        userAgent: null,
        referrer: null,
      },
    ]);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/urls/${code}`,
          headers: { authorization: `Bearer ${rawKey}` },
        })
      ).statusCode,
    ).toBe(204);

    const stats = await app.inject({
      method: 'GET',
      url: `/api/v1/urls/${code}/stats`,
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json<{ totalClicks: number }>().totalClicks).toBe(1);
  });
});
