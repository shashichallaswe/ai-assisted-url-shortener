import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createTestPool, isDatabaseAvailable } from '../helpers/database.js';

const databaseAvailable = await isDatabaseAvailable();

if (!databaseAvailable) {
  process.stdout.write(
    '\nPostgreSQL is not reachable; migration integration tests are skipped.\n' +
      'Start it with `docker compose up -d` to run them.\n\n',
  );
}

// These tests never drop or truncate anything: DATABASE_URL may point at a
// developer's working database. They assert reachable end state instead.
describe.skipIf(!databaseAvailable)('migrate against PostgreSQL', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies the schema and leaves the four documented tables in place', async () => {
    await migrate(pool);

    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = rows.map((row) => row.table_name);

    expect(tables).toEqual(
      expect.arrayContaining(['api_keys', 'urls', 'click_events', 'idempotency_keys']),
    );
  });

  it('applies nothing on a second run', async () => {
    await migrate(pool);

    expect(await migrate(pool)).toStrictEqual([]);
  });

  it('records each migration exactly once', async () => {
    await migrate(pool);
    await migrate(pool);

    const { rows } = await pool.query<{ count: string }>(
      `select count(*) as count from schema_migrations where name = '0001_initial_schema.sql'`,
    );

    expect(rows[0]?.count).toBe('1');
  });

  it('refuses to run when an applied migration has been edited', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'migrations-edited-'));
    writeFileSync(join(directory, '0001_initial_schema.sql'), 'select 1;', 'utf8');

    try {
      await migrate(pool);
      await expect(migrate(pool, directory)).rejects.toThrow(/edited after it was applied/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('schema constraints', () => {
    it('rejects a short code that is not seven characters', async () => {
      const client = await pool.connect();

      try {
        await client.query('begin');
        await expect(
          client.query(
            `insert into urls (code, destination_url, created_by)
             values ('short', 'https://example.com', gen_random_uuid())`,
          ),
        ).rejects.toThrow();
      } finally {
        await client.query('rollback');
        client.release();
      }
    });

    it('rejects a non-https destination at the database level', async () => {
      const client = await pool.connect();

      try {
        await client.query('begin');
        await expect(
          client.query(
            `insert into urls (code, destination_url, created_by)
             values ('aB3xY7z', 'http://example.com', gen_random_uuid())`,
          ),
        ).rejects.toThrow();
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });
});
