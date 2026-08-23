import pg from 'pg';
import type { Pool, PoolConfig } from 'pg';

export function createPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ...overrides,
  });
}
