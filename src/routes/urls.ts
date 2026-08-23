import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { firstHeader } from '../lib/headers.js';
import { HttpError } from '../lib/http-error.js';
import { authenticateApiKey, parseBearerToken } from '../security/auth.js';
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
