import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { firstHeader } from '../lib/headers.js';
import { HttpError } from '../lib/errors/http-error.js';
import { selectClickStats } from '../repos/click-events.js';
import { findUrlByCode } from '../repos/urls.js';
import { authenticateApiKey, parseBearerToken } from '../security/auth.js';
import { enforceRateLimit } from '../security/rate-limit.js';
import { getUrlMetadata } from '../services/redirect.js';
import { getUrlStats, parseStatsDays } from '../services/stats.js';
import { createUrl } from '../services/urls.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

const createUrlBodySchema = z.object({
  originalUrl: z.string().min(1).max(2048),
  expiresAt: z.iso.datetime().optional(),
});

export const urlRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/urls', async (request, reply) => {
    const rawKey = parseBearerToken(firstHeader(request.headers.authorization));
    const apiKey = await authenticateApiKey(app.db, rawKey);
    const { rateLimiter, rateLimits, clock } = app.appConfig;
    await enforceRateLimit(
      rateLimiter,
      'create',
      apiKey.id,
      rateLimits.createMax,
      rateLimits.createWindowSeconds,
      clock(),
    );
    const body = parseCreateUrlBody(request.body);
    const idempotencyKey = parseIdempotencyKey(firstHeader(request.headers['idempotency-key']));

    const created = await createUrl(
      {
        pool: app.db,
        baseUrl: app.appConfig.baseUrl,
        clock: app.appConfig.clock,
        generateCode: app.appConfig.generateCode,
      },
      apiKey,
      {
        originalUrl: body.originalUrl,
        expiresAt: body.expiresAt,
        idempotencyKey,
      },
    );

    return reply.status(201).header('Location', created.shortUrl).send(created);
  });

  app.get('/urls/:code', async (request, reply) => {
    const rawKey = parseBearerToken(firstHeader(request.headers.authorization));
    await authenticateApiKey(app.db, rawKey);
    const metadata = await getUrlMetadata(
      {
        baseUrl: app.appConfig.baseUrl,
        findByCode: (code) => findUrlByCode(app.db, code),
      },
      (request.params as { code: string }).code,
    );
    return reply.status(200).send(metadata);
  });

  app.get('/urls/:code/stats', async (request, reply) => {
    const rawKey = parseBearerToken(firstHeader(request.headers.authorization));
    await authenticateApiKey(app.db, rawKey);

    const { days } = request.query as { days?: unknown };
    const stats = await getUrlStats(
      {
        clock: app.appConfig.clock,
        findByCode: (code) => findUrlByCode(app.db, code),
        loadStats: (urlId, since) => selectClickStats(app.db, urlId, since),
      },
      (request.params as { code: string }).code,
      parseStatsDays(typeof days === 'string' ? days : undefined),
    );
    return reply.status(200).send(stats);
  });
  done();
};

function parseCreateUrlBody(body: unknown): { originalUrl: string; expiresAt?: Date } {
  const parsed = createUrlBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation_error',
      'Invalid request',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    );
  }

  return {
    originalUrl: parsed.data.originalUrl,
    expiresAt: parsed.data.expiresAt === undefined ? undefined : new Date(parsed.data.expiresAt),
  };
}

function parseIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    throw new HttpError(400, 'validation_error', 'Invalid request', [
      { field: 'Idempotency-Key', message: 'must not be empty' },
    ]);
  }
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'validation_error', 'Invalid request', [
      {
        field: 'Idempotency-Key',
        message: `must be at most ${String(MAX_IDEMPOTENCY_KEY_LENGTH)} characters`,
      },
    ]);
  }
  return trimmed;
}
