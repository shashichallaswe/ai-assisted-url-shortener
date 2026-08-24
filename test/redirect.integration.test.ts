import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryUrlCache } from '../src/cache/memory-url-cache.js';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { insertApiKey } from './helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from './helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; redirect integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';
const VALID_URL = 'https://example.com/redirect-me';

describe.skipIf(!databaseAvailable)('GET /:code', () => {
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

  async function create(originalUrl: string, expiresAt?: string): Promise<string> {
    const payload: { originalUrl: string; expiresAt?: string } = { originalUrl };
    if (expiresAt !== undefined) {
      payload.expiresAt = expiresAt;
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      headers: { authorization: `Bearer ${rawKey}` },
      payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ code: string }>().code;
  }

  it('redirects a live code with 302, no-store, and the stored destination', async () => {
    const code = await create(VALID_URL);
    const response = await app.inject({ method: 'GET', url: `/${code}` });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(VALID_URL);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('serves the second request from cache', async () => {
    const code = await create('https://example.com/cached');
    const before = cache.sets;
    await app.inject({ method: 'GET', url: `/${code}` });
    const afterMiss = cache.hits;
    const response = await app.inject({ method: 'GET', url: `/${code}` });

    expect(response.statusCode).toBe(302);
    expect(cache.sets).toBeGreaterThan(before);
    expect(cache.hits).toBeGreaterThan(afterMiss);
  });

  it('returns 404 for an unknown well-formed code', async () => {
    await pool.query(`delete from urls where code = $1`, ['NoHit01']);
    const response = await app.inject({ method: 'GET', url: '/NoHit01' });
    expect(response.statusCode).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });

  it('returns 404 for a malformed code', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });

  it('does not treat reserved paths as short codes', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const openapi = await app.inject({ method: 'GET', url: '/openapi' });
    expect(openapi.statusCode).toBe(404);
    expect(openapi.headers.location).toBeUndefined();
  });

  it('returns 404 for an expired code even when the cache still holds it', async () => {
    const code = await create(VALID_URL, '2099-01-01T00:00:00.000Z');
    await app.inject({ method: 'GET', url: `/${code}` });

    const future = await buildApp({
      logger: false,
      pool,
      baseUrl: BASE_URL,
      cache,
      clock: () => new Date('2099-06-01T00:00:00.000Z'),
    });
    await future.ready();
    try {
      const response = await future.inject({ method: 'GET', url: `/${code}` });
      expect(response.statusCode).toBe(404);
      expect(response.headers.location).toBeUndefined();
    } finally {
      await future.close();
    }
  });

  it('returns 404 for a soft-deleted code after the cache is invalidated', async () => {
    const code = await create('https://example.com/takedown');
    await app.inject({ method: 'GET', url: `/${code}` });
    await pool.query(`update urls set deleted_at = now() where code = $1`, [code]);
    await cache.del(code);

    const response = await app.inject({ method: 'GET', url: `/${code}` });
    expect(response.statusCode).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });
});

describe.skipIf(!databaseAvailable)('GET /api/v1/urls/:code', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let rawKey: string;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
    app = await buildApp({ logger: false, pool, baseUrl: BASE_URL });
    await app.ready();
    ({ rawKey } = await insertApiKey(pool));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns 401 without a key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/urls/aB3xY7z' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 metadata for a live code', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { originalUrl: VALID_URL },
    });
    const code = created.json<{ code: string }>().code;
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/urls/${code}`,
      headers: { authorization: `Bearer ${rawKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code,
      originalUrl: VALID_URL,
      shortUrl: `${BASE_URL}/${code}`,
    });
  });
});
