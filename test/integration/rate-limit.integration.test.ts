import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from '../../src/cache/memory-rate-limiter.js';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { insertApiKey } from '../helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from '../helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; rate-limit integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';
const VALID_URL = 'https://example.com/rate-limit';

describe.skipIf(!databaseAvailable)('rate limits', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeApp(clock: () => Date): Promise<FastifyInstance> {
    const instance = await buildApp({
      logger: false,
      pool,
      baseUrl: BASE_URL,
      clock,
      rateLimiter: new MemoryRateLimiter(clock),
      rateLimits: {
        createMax: 2,
        createWindowSeconds: 60,
        redirectMax: 2,
        redirectWindowSeconds: 60,
        ipPepper: 'test-rate-limit-pepper',
      },
    });
    await instance.ready();
    return instance;
  }

  it('returns 429 with Retry-After when the create limit is exceeded', async () => {
    const { rawKey } = await insertApiKey(pool);
    const app = await makeApp(() => new Date('2026-08-24T12:00:00.000Z'));
    try {
      const headers = { authorization: `Bearer ${rawKey}` };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/urls',
            headers,
            payload: { originalUrl: VALID_URL },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/urls',
            headers,
            payload: { originalUrl: VALID_URL },
          })
        ).statusCode,
      ).toBe(201);

      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers,
        payload: { originalUrl: VALID_URL },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
      expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
    } finally {
      await app.close();
    }
  });

  it('returns 429 with Retry-After when the redirect limit is exceeded', async () => {
    const { rawKey } = await insertApiKey(pool);
    const app = await makeApp(() => new Date('2026-08-24T12:00:00.000Z'));
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers: { authorization: `Bearer ${rawKey}` },
        payload: { originalUrl: VALID_URL },
      });
      const code = created.json<{ code: string }>().code;

      expect((await app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(302);
      expect((await app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(302);

      const limited = await app.inject({ method: 'GET', url: `/${code}` });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
    } finally {
      await app.close();
    }
  });

  it('lets a client recover after the window', async () => {
    let now = new Date('2026-08-24T12:00:00.000Z');
    const { rawKey } = await insertApiKey(pool);
    const app = await makeApp(() => now);
    try {
      const headers = { authorization: `Bearer ${rawKey}` };
      await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers,
        payload: { originalUrl: VALID_URL },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers,
        payload: { originalUrl: VALID_URL },
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/urls',
            headers,
            payload: { originalUrl: VALID_URL },
          })
        ).statusCode,
      ).toBe(429);

      now = new Date('2026-08-24T12:01:00.000Z');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/urls',
            headers,
            payload: { originalUrl: VALID_URL },
          })
        ).statusCode,
      ).toBe(201);
    } finally {
      await app.close();
    }
  });
});
