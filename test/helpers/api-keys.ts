import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

export async function insertApiKey(
  pool: Pool,
  options: { revoked?: boolean } = {},
): Promise<{ id: string; rawKey: string }> {
  const rawKey = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(rawKey, 'utf8').digest();
  const prefix = rawKey.slice(0, 8);
  const { rows } = await pool.query<{ id: string }>(
    `insert into api_keys (name, key_hash, key_prefix, revoked_at)
     values ($1, $2, $3, $4)
     returning id`,
    ['test', hash, prefix, options.revoked === true ? new Date() : null],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('failed to insert api key');
  }
  return { id, rawKey };
}
