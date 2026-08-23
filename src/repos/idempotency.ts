import type { Pool, PoolClient } from 'pg';

export interface IdempotencyRecord {
  id: string;
  requestFingerprint: Buffer;
  urlId: string | null;
  expiresAt: Date;
}

interface IdempotencyRow {
  id: string;
  request_fingerprint: Buffer;
  url_id: string | null;
  expires_at: Date;
}

export async function findIdempotencyKey(
  db: Pool | PoolClient,
  apiKeyId: string,
  idempotencyKey: string,
): Promise<IdempotencyRecord | null> {
  const { rows } = await db.query<IdempotencyRow>(
    `select id, request_fingerprint, url_id, expires_at
       from idempotency_keys
      where api_key_id = $1 and idempotency_key = $2`,
    [apiKeyId, idempotencyKey],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    requestFingerprint: row.request_fingerprint,
    urlId: row.url_id,
    expiresAt: row.expires_at,
  };
}

export async function insertIdempotencyReservation(
  db: Pool | PoolClient,
  input: {
    apiKeyId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
  },
): Promise<void> {
  await db.query(
    `insert into idempotency_keys (api_key_id, idempotency_key, request_fingerprint, response_status)
     values ($1, $2, $3, 201)`,
    [input.apiKeyId, input.idempotencyKey, input.requestFingerprint],
  );
}

export async function attachIdempotencyUrl(
  db: Pool | PoolClient,
  apiKeyId: string,
  idempotencyKey: string,
  urlId: string,
): Promise<void> {
  await db.query(
    `update idempotency_keys
        set url_id = $3
      where api_key_id = $1 and idempotency_key = $2`,
    [apiKeyId, idempotencyKey, urlId],
  );
}

export async function deleteIdempotencyKey(db: Pool | PoolClient, id: string): Promise<void> {
  await db.query(`delete from idempotency_keys where id = $1`, [id]);
}
