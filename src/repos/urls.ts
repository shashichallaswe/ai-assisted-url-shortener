import type { Pool, PoolClient } from 'pg';

export interface UrlRecord {
  id: string;
  code: string;
  destinationUrl: string;
  expiresAt: Date | null;
}

interface UrlRow {
  id: string;
  code: string;
  destination_url: string;
  expires_at: Date | null;
}

export async function insertUrl(
  db: Pool | PoolClient,
  input: {
    code: string;
    destinationUrl: string;
    createdBy: string;
    expiresAt: Date | null;
  },
): Promise<UrlRecord> {
  const { rows } = await db.query<UrlRow>(
    `insert into urls (code, destination_url, created_by, expires_at)
     values ($1, $2, $3, $4)
     returning id, code, destination_url, expires_at`,
    [input.code, input.destinationUrl, input.createdBy, input.expiresAt],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('url insert returned no row');
  }
  return mapUrl(row);
}

export async function findUrlById(db: Pool | PoolClient, id: string): Promise<UrlRecord | null> {
  const { rows } = await db.query<UrlRow>(
    `select id, code, destination_url, expires_at from urls where id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : mapUrl(row);
}

function mapUrl(row: UrlRow): UrlRecord {
  return {
    id: row.id,
    code: row.code,
    destinationUrl: row.destination_url,
    expiresAt: row.expires_at,
  };
}
