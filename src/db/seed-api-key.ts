import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { insertApiKeyHash } from '../repos/api-keys.js';
import { apiKeyPrefix, hashApiKey } from '../security/auth.js';

/**
 * Hashes a demo key and upserts it. The raw value is never written to the
 * database and must never be logged.
 */
export async function ensureDemoApiKey(
  pool: Pool,
  rawKey: string,
  logger: FastifyBaseLogger,
): Promise<void> {
  const prefix = apiKeyPrefix(rawKey);
  await insertApiKeyHash(pool, {
    name: 'demo',
    keyHash: hashApiKey(rawKey),
    keyPrefix: prefix,
  });
  logger.info({ keyPrefix: prefix }, 'demo API key present');
}
