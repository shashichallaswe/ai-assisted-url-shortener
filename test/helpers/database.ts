import type { Pool } from 'pg';
import { createPool } from '../../src/db/pool.js';

export const testDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgres://shortener:shortener@localhost:5432/shortener';

/**
 * Integration tests are skipped, not failed, when PostgreSQL is not running.
 * A contributor without Docker still gets a green suite for everything that
 * does not need a database.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const pool = createPool(testDatabaseUrl, { max: 1, connectionTimeoutMillis: 1_000 });

  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export function createTestPool(): Pool {
  return createPool(testDatabaseUrl, { max: 4 });
}
