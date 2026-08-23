import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { insertApiKey } from './helpers/api-keys.js';
import { createTestPool, isDatabaseAvailable } from './helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; create-URL integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

const BASE_URL = 'http://short.test';
const VALID_URL = 'https://example.com/a';

interface ErrorBody {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

interface CreatedBody {
  code: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
}

describe.skipIf(!databaseAvailable)('POST /api/v1/urls', () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createTestPool();
    await migrate(pool);
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function makeApp(overrides: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
    const instance = await buildApp({
      logger: false,
      pool,
      baseUrl: BASE_URL,
      ...overrides,
    });
    await instance.ready();
    return instance;
  }

  async function post(
    rawKey: string | undefined,
    payload: object,
    extraHeaders: Record<string, string> = {},
    instance: FastifyInstance = app,
  ) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (rawKey !== undefined) {
      headers.authorization = `Bearer ${rawKey}`;
    }
    return instance.inject({
      method: 'POST',
      url: '/api/v1/urls',
      headers,
      payload,
    });
  }

  describe('authentication', () => {
    it('returns 401 when the Authorization header is missing', async () => {
      const response = await post(undefined, { originalUrl: VALID_URL });

      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toMatchObject({
        code: 'unauthorized',
        message: 'Unauthorized',
      });
    });

    it('returns 401 when the Authorization header is malformed', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        headers: { authorization: 'Basic abc' },
        payload: { originalUrl: VALID_URL },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error.code).toBe('unauthorized');
    });

    it('returns 401 for an unknown key', async () => {
      const response = await post('unknown-key-value-0000', { originalUrl: VALID_URL });

      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error.code).toBe('unauthorized');
    });

    it('returns 401 for a revoked key, with the same body as unknown', async () => {
      const { rawKey } = await insertApiKey(pool, { revoked: true });
      const response = await post(rawKey, { originalUrl: VALID_URL });

      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toMatchObject({
        code: 'unauthorized',
        message: 'Unauthorized',
      });
    });
  });

  describe('validation', () => {
    it('returns 400 with field-level detail when originalUrl is missing', async () => {
      const { rawKey } = await insertApiKey(pool);
      const response = await post(rawKey, {});

      expect(response.statusCode).toBe(400);
      const body = response.json<ErrorBody>();
      expect(body.error.code).toBe('validation_error');
      expect(body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'originalUrl' })]),
      );
    });

    it('returns 400 when originalUrl has the wrong type', async () => {
      const { rawKey } = await insertApiKey(pool);
      const response = await post(rawKey, { originalUrl: 12 });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'originalUrl' })]),
      );
    });

    it.each(['http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'https://localhost/', 'https://10.0.0.1/'])(
      'returns 400 for rejected destination %s',
      async (originalUrl) => {
        const { rawKey } = await insertApiKey(pool);
        const response = await post(rawKey, { originalUrl });

        expect(response.statusCode).toBe(400);
        const body = response.json<ErrorBody>();
        expect(body.error.code).toBe('destination_not_allowed');
        expect(body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'originalUrl' })]),
        );
        expect(JSON.stringify(body)).not.toContain(originalUrl);
      },
    );

    it('returns 400 when expiresAt is not a datetime', async () => {
      const { rawKey } = await insertApiKey(pool);
      const response = await post(rawKey, { originalUrl: VALID_URL, expiresAt: 'tomorrow' });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'expiresAt' })]),
      );
    });

    it('returns 400 when expiresAt is in the past', async () => {
      const clocked = await makeApp({ clock: () => new Date('2026-08-23T12:00:00.000Z') });
      try {
        const { rawKey } = await insertApiKey(pool);
        const response = await post(
          rawKey,
          { originalUrl: VALID_URL, expiresAt: '2026-08-23T11:00:00.000Z' },
          {},
          clocked,
        );

        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'expiresAt' })]),
        );
      } finally {
        await clocked.close();
      }
    });
  });

  describe('success', () => {
    it('returns 201, persists the mapping, and builds shortUrl from configured BASE_URL', async () => {
      const { id, rawKey } = await insertApiKey(pool);
      const response = await post(rawKey, { originalUrl: VALID_URL }, { host: 'evil.example' });

      expect(response.statusCode).toBe(201);
      const body = response.json<CreatedBody>();
      expect(body.code).toMatch(/^[0-9A-Za-z]{7}$/);
      expect(body.shortUrl).toBe(`${BASE_URL}/${body.code}`);
      expect(body.shortUrl).not.toContain('evil.example');
      expect(body.originalUrl).toBe(VALID_URL);
      expect(body.expiresAt).toBeNull();
      expect(response.headers.location).toBe(body.shortUrl);

      const { rows } = await pool.query<{ destination_url: string; created_by: string }>(
        'select destination_url, created_by from urls where code = $1',
        [body.code],
      );
      expect(rows[0]?.destination_url).toBe(VALID_URL);
      expect(rows[0]?.created_by).toBe(id);
    });

    it('stores and returns a future expiresAt', async () => {
      const { rawKey } = await insertApiKey(pool);
      const expiresAt = '2099-01-01T00:00:00.000Z';
      const response = await post(rawKey, { originalUrl: VALID_URL, expiresAt });

      expect(response.statusCode).toBe(201);
      expect(response.json<CreatedBody>().expiresAt).toBe(expiresAt);
    });
  });

  describe('idempotency', () => {
    it('replays the original 201 when the key and body match', async () => {
      const { id, rawKey } = await insertApiKey(pool);
      const headers = { 'idempotency-key': 'same-body' };
      const first = await post(rawKey, { originalUrl: VALID_URL }, headers);
      const second = await post(rawKey, { originalUrl: VALID_URL }, headers);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json<CreatedBody>().code).toBe(first.json<CreatedBody>().code);

      const { rows } = await pool.query<{ n: number }>(
        'select count(*)::int as n from urls where created_by = $1',
        [id],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('returns 409 when the same key is reused with a different body', async () => {
      const { rawKey } = await insertApiKey(pool);
      const headers = { 'idempotency-key': 'different-body' };
      const first = await post(rawKey, { originalUrl: VALID_URL }, headers);
      const second = await post(rawKey, { originalUrl: 'https://example.com/b' }, headers);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(409);
      expect(second.json<ErrorBody>().error.code).toBe('idempotency_key_mismatch');
    });

    it('scopes idempotency keys per API key', async () => {
      const first = await insertApiKey(pool);
      const second = await insertApiKey(pool);
      const headers = { 'idempotency-key': 'shared-across-keys' };

      const a = await post(first.rawKey, { originalUrl: VALID_URL }, headers);
      const b = await post(second.rawKey, { originalUrl: VALID_URL }, headers);

      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(a.json<CreatedBody>().code).not.toBe(b.json<CreatedBody>().code);
    });
  });

  describe('code collisions', () => {
    it('retries transparently when the generated code is already taken', async () => {
      const { id, rawKey } = await insertApiKey(pool);
      await pool.query(`delete from urls where code = any($1::text[])`, [['AAAAAAA', 'BBBBBBB']]);
      await pool.query(
        `insert into urls (code, destination_url, created_by) values ($1, $2, $3)`,
        ['AAAAAAA', VALID_URL, id],
      );
      const generateCode = vi.fn().mockReturnValueOnce('AAAAAAA').mockReturnValueOnce('BBBBBBB');
      const colliding = await makeApp({ generateCode });

      try {
        const response = await post(rawKey, { originalUrl: 'https://example.com/retry' }, {}, colliding);

        expect(response.statusCode).toBe(201);
        expect(response.json<CreatedBody>().code).toBe('BBBBBBB');
        expect(generateCode).toHaveBeenCalledTimes(2);
      } finally {
        await colliding.close();
      }
    });

    it('returns 503 rather than a duplicate when retries are exhausted', async () => {
      const { id, rawKey } = await insertApiKey(pool);
      await pool.query(`delete from urls where code = $1`, ['CCCCCCC']);
      await pool.query(
        `insert into urls (code, destination_url, created_by) values ($1, $2, $3)`,
        ['CCCCCCC', VALID_URL, id],
      );
      const generateCode = vi.fn().mockReturnValue('CCCCCCC');
      const exhausted = await makeApp({ generateCode });

      try {
        const response = await post(rawKey, { originalUrl: 'https://example.com/exhaust' }, {}, exhausted);

        expect(response.statusCode).toBe(503);
        expect(response.json<ErrorBody>().error.code).toBe('code_generation_exhausted');

        const { rows } = await pool.query<{ n: number }>(
          `select count(*)::int as n from urls where code = 'CCCCCCC'`,
        );
        expect(rows[0]?.n).toBe(1);
      } finally {
        await exhausted.close();
      }
    });
  });
});
