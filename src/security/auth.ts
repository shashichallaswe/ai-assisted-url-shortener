import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { unauthorized } from '../lib/errors/http-error.js';
import { findApiKeyByHash, type ApiKeyRecord } from '../repos/api-keys.js';

const ZERO_HASH = Buffer.alloc(32);

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

export function hashesMatch(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function authenticateApiKey(
  db: Pool | PoolClient,
  rawKey: string,
): Promise<ApiKeyRecord> {
  const digest = hashApiKey(rawKey);
  const record = await findApiKeyByHash(db, digest);
  const stored = record?.keyHash ?? ZERO_HASH;
  if (record === null || record.revokedAt !== null || !hashesMatch(digest, stored)) {
    throw unauthorized();
  }
  return record;
}
