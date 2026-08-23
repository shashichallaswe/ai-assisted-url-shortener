import type { Pool, PoolClient } from 'pg';

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Prefer the original error; rollback failure is a consequence.
    }
    throw error;
  } finally {
    client.release();
  }
}
