import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { unauthorized } from '../lib/http-error.js';
import { findApiKeyByHash, type ApiKeyRecord } from '../repos/api-keys.js';

export function parseBearerToken(header: string | undefined): string {
  if (header === undefined) {
    throw unauthorized();
  }

  const match = /^Bearer[ \t]+(\S+)$/iu.exec(header);
  const token = match?.[1];
  if (token === undefined) {
    throw unauthorized();
  }

  return token;
}

export function hashApiKey(rawKey: string): Buffer {
  return createHash('sha256').update(rawKey, 'utf8').digest();
}

export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

export async function authenticateApiKey(
  db: Pool | PoolClient,
  rawKey: string,
): Promise<ApiKeyRecord> {
  const record = await findApiKeyByHash(db, hashApiKey(rawKey));
  if (record === null || record.revokedAt !== null) {
    throw unauthorized();
  }
  return record;
}
