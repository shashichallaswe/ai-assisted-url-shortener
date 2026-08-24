import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.js';
import { isPublicCode, isReservedCode, isWellFormedCode } from '../lib/codes.js';
import type { UrlCache } from '../cache/url-cache.js';
import { HttpError, notFound } from '../lib/errors/http-error.js';
import { isUniqueViolation } from '../lib/errors/pg.js';
import { publicShortUrl } from '../lib/public-url.js';
import type { ApiKeyRecord } from '../repos/api-keys.js';
import {
  attachIdempotencyUrl,
  deleteIdempotencyKey,
  findIdempotencyKey,
  insertIdempotencyReservation,
  type IdempotencyRecord,
} from '../repos/idempotency.js';
import {
  findUrlByCode,
  findUrlById,
  insertUrl,
  markUrlDeleted,
  type UrlRecord,
} from '../repos/urls.js';
import { invalidateUrlCache } from './redirect.js';
import { inspectDestination } from '../security/url-policy.js';

const CODE_ATTEMPTS = 3;
const URLS_CODE_CONSTRAINT = 'urls_code_key';
const IDEMPOTENCY_SCOPE_CONSTRAINT = 'idempotency_keys_scope_unique';

export interface CreateUrlDeps {
  pool: Pool;
  baseUrl: string;
  clock: () => Date;
  generateCode: () => string;
}

export interface CreateUrlInput {
  originalUrl: string;
  expiresAt?: Date;
  customAlias?: string;
  idempotencyKey?: string;
}

export interface CreatedUrl {
  code: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
}

export async function createUrl(
  deps: CreateUrlDeps,
  apiKey: ApiKeyRecord,
  input: CreateUrlInput,
): Promise<CreatedUrl> {
  const inspected = inspectDestination(input.originalUrl);
  if (!inspected.ok) {
    throw new HttpError(400, 'destination_not_allowed', 'Destination URL is not allowed', [
      { field: 'originalUrl', message: inspected.reason },
    ]);
  }

  const now = deps.clock();
  if (input.expiresAt !== undefined && input.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'validation_error', 'Invalid request', [
      { field: 'expiresAt', message: 'must be in the future' },
    ]);
  }

  if (input.customAlias !== undefined) {
    if (isReservedCode(input.customAlias) || !isPublicCode(input.customAlias)) {
      throw new HttpError(400, 'validation_error', 'Invalid request', [
        {
          field: 'customAlias',
          message: isReservedCode(input.customAlias)
            ? 'is reserved'
            : 'must be 4–32 characters of [0-9A-Za-z_-]',
        },
      ]);
    }
  }

  const fingerprint = requestFingerprint(inspected.href, input.expiresAt, input.customAlias);

  return withTransaction(deps.pool, async (client) => {
    if (input.idempotencyKey !== undefined) {
      const replay = await replayOrReserve(
        client,
        apiKey.id,
        input.idempotencyKey,
        fingerprint,
        now,
        deps.baseUrl,
      );
      if (replay !== undefined) {
        return replay;
      }
    }

    if (input.customAlias !== undefined) {
      return insertChosenCode(client, deps.baseUrl, apiKey.id, {
        code: input.customAlias,
        destinationUrl: inspected.href,
        createdBy: apiKey.id,
        expiresAt: input.expiresAt ?? null,
        idempotencyKey: input.idempotencyKey,
      });
    }

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = deps.generateCode();
      if (isReservedCode(code) || !isWellFormedCode(code)) {
        continue;
      }
      // A unique violation aborts the whole Postgres transaction unless it is
      // isolated in a savepoint. Without this, the retry INSERT fails with 25P02.
      await client.query('savepoint code_attempt');
      try {
        const url = await insertUrl(client, {
          code,
          destinationUrl: inspected.href,
          createdBy: apiKey.id,
          expiresAt: input.expiresAt ?? null,
        });
        await client.query('release savepoint code_attempt');
        if (input.idempotencyKey !== undefined) {
          await attachIdempotencyUrl(client, apiKey.id, input.idempotencyKey, url.id);
        }
        return toCreated(url, deps.baseUrl);
      } catch (error) {
        await client.query('rollback to savepoint code_attempt');
        if (isUniqueViolation(error, URLS_CODE_CONSTRAINT)) {
          continue;
        }
        throw error;
      }
    }

    throw new HttpError(503, 'code_generation_exhausted', 'Unable to allocate a unique short code');
  });
}

async function insertChosenCode(
  client: PoolClient,
  baseUrl: string,
  apiKeyId: string,
  input: {
    code: string;
    destinationUrl: string;
    createdBy: string;
    expiresAt: Date | null;
    idempotencyKey: string | undefined;
  },
): Promise<CreatedUrl> {
  await client.query('savepoint code_attempt');
  try {
    const url = await insertUrl(client, {
      code: input.code,
      destinationUrl: input.destinationUrl,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    });
    await client.query('release savepoint code_attempt');
    if (input.idempotencyKey !== undefined) {
      await attachIdempotencyUrl(client, apiKeyId, input.idempotencyKey, url.id);
    }
    return toCreated(url, baseUrl);
  } catch (error) {
    await client.query('rollback to savepoint code_attempt');
    if (isUniqueViolation(error, URLS_CODE_CONSTRAINT)) {
      throw new HttpError(409, 'alias_conflict', 'Custom alias is already in use');
    }
    throw error;
  }
}

async function replayOrReserve(
  client: PoolClient,
  apiKeyId: string,
  idempotencyKey: string,
  fingerprint: Buffer,
  now: Date,
  baseUrl: string,
): Promise<CreatedUrl | undefined> {
  const existing = await findIdempotencyKey(client, apiKeyId, idempotencyKey);
  if (existing !== null && existing.expiresAt.getTime() > now.getTime()) {
    return replayExisting(client, existing, fingerprint, baseUrl);
  }
  if (existing !== null) {
    await deleteIdempotencyKey(client, existing.id);
  }

  try {
    await insertIdempotencyReservation(client, {
      apiKeyId,
      idempotencyKey,
      requestFingerprint: fingerprint,
    });
    return undefined;
  } catch (error) {
    if (!isUniqueViolation(error, IDEMPOTENCY_SCOPE_CONSTRAINT)) {
      throw error;
    }
    const raced = await findIdempotencyKey(client, apiKeyId, idempotencyKey);
    if (raced === null) {
      throw new HttpError(500, 'internal_error', 'Internal server error');
    }
    return replayExisting(client, raced, fingerprint, baseUrl);
  }
}

async function replayExisting(
  client: PoolClient,
  existing: IdempotencyRecord,
  fingerprint: Buffer,
  baseUrl: string,
): Promise<CreatedUrl> {
  if (!fingerprintsMatch(existing.requestFingerprint, fingerprint)) {
    throw new HttpError(
      409,
      'idempotency_key_mismatch',
      'Idempotency-Key was reused with a different request',
    );
  }
  if (existing.urlId === null) {
    throw new HttpError(500, 'internal_error', 'Internal server error');
  }
  const url = await findUrlById(client, existing.urlId);
  if (url === null) {
    throw new HttpError(500, 'internal_error', 'Internal server error');
  }
  return toCreated(url, baseUrl);
}

export interface DeleteUrlDeps {
  pool: Pool;
  cache: UrlCache;
  clock: () => Date;
}

export async function deleteUrl(deps: DeleteUrlDeps, code: string): Promise<void> {
  if (isReservedCode(code) || !isPublicCode(code)) {
    throw notFound();
  }
  const row = await findUrlByCode(deps.pool, code);
  if (row === null) {
    throw notFound();
  }
  if (row.deletedAt === null) {
    await markUrlDeleted(deps.pool, code, deps.clock());
  }
  await invalidateUrlCache(deps.cache, code);
}

function requestFingerprint(
  originalUrl: string,
  expiresAt: Date | undefined,
  customAlias: string | undefined,
): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify({
        originalUrl,
        expiresAt: expiresAt?.toISOString() ?? null,
        customAlias: customAlias ?? null,
      }),
      'utf8',
    )
    .digest();
}

function fingerprintsMatch(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function toCreated(url: UrlRecord, baseUrl: string): CreatedUrl {
  return {
    code: url.code,
    shortUrl: publicShortUrl(baseUrl, url.code),
    originalUrl: url.destinationUrl,
    expiresAt: url.expiresAt === null ? null : url.expiresAt.toISOString(),
  };
}
