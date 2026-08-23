import type { Pool, PoolClient } from 'pg';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  revokedAt: Date | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  revoked_at: Date | null;
}

export async function findApiKeyByHash(
  db: Pool | PoolClient,
  keyHash: Buffer,
): Promise<ApiKeyRecord | null> {
  const { rows } = await db.query<ApiKeyRow>(
    `select id, name, key_prefix, revoked_at from api_keys where key_hash = $1`,
    [keyHash],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    revokedAt: row.revoked_at,
  };
}

export async function insertApiKeyHash(
  db: Pool | PoolClient,
  input: { name: string; keyHash: Buffer; keyPrefix: string },
): Promise<void> {
  await db.query(
    `insert into api_keys (name, key_hash, key_prefix)
     values ($1, $2, $3)
     on conflict (key_hash) do nothing`,
    [input.name, input.keyHash, input.keyPrefix],
  );
}
