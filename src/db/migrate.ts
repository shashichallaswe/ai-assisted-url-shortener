import type { Pool, PoolClient } from 'pg';
import { MIGRATIONS_DIR, discoverMigrations } from './migrations.js';

/**
 * Fixed key for `pg_advisory_lock`. Two instances booting at once must not
 * apply the same migration twice; the second waits here instead.
 */
const MIGRATION_LOCK_KEY = 4_919_142_073;

const LEDGER_DDL = `
  create table if not exists schema_migrations (
    version     bigint      primary key,
    name        text        not null unique,
    checksum    text        not null,
    applied_at  timestamptz not null default now()
  )
`;

interface LedgerRow {
  name: string;
  checksum: string;
}

/**
 * Applies every migration not yet recorded in `schema_migrations` and returns
 * the names applied. Running it again with no new files applies nothing and
 * returns an empty array.
 */
export async function migrate(pool: Pool, directory: string = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = discoverMigrations(directory);
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(LEDGER_DDL);

    const ledger = await client.query<LedgerRow>('select name, checksum from schema_migrations');
    const alreadyApplied = new Map(ledger.rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const recordedChecksum = alreadyApplied.get(migration.name);

      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was edited after it was applied. ` +
              'Add a new migration instead; the database and the file no longer agree.',
          );
        }
        continue;
      }

      await applyOne(client, migration.version, migration.name, migration.sql, migration.checksum);
      applied.push(migration.name);
    }
  } finally {
    await releaseLock(client);
    client.release();
  }

  return applied;
}

async function applyOne(
  client: PoolClient,
  version: number,
  name: string,
  sql: string,
  checksum: string,
): Promise<void> {
  await client.query('begin');

  try {
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (version, name, checksum) values ($1, $2, $3)',
      [version, name, checksum],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function releaseLock(client: PoolClient): Promise<void> {
  try {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  } catch {
    // The connection is already gone, which releases the lock anyway.
  }
}
