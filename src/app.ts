import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { ClickCapture } from './analytics/click-capture.js';
import { MemoryClickCounters } from './cache/memory-click-counters.js';
import type { UrlCache } from './cache/url-cache.js';
import { MemoryRateLimiter } from './cache/memory-rate-limiter.js';
import { MemoryUrlCache } from './cache/memory-url-cache.js';
import { generateShortCode } from './lib/codes.js';
import {
  RATE_LIMIT_IN_PROCESS_IP_PEPPER,
  RATE_LIMIT_IN_PROCESS_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
} from './lib/constants.js';
import type { RateLimitConfig, RateLimiter } from './security/rate-limit.js';
import { insertClickEvents } from './repos/click-events.js';
import { accessLogFields } from './observability/access-log.js';
import { createLoggerOptions } from './observability/logger.js';
import type { ReadinessProbes } from './observability/readiness.js';
import { requestIdFromHeaders } from './observability/request-id.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { redirectRoutes } from './routes/redirect.js';
import { urlRoutes } from './routes/urls.js';

export interface BuildAppOptions {
  /** Set false to silence request logging, which tests do. */
  logger?: boolean;
  pool?: Pool;
  baseUrl?: string;
  clock?: () => Date;
  generateCode?: () => string;
  cache?: UrlCache;
  clicks?: ClickCapture;
  clickIpSalt?: string;
  rateLimiter?: RateLimiter;
  rateLimits?: RateLimitConfig;
  checkPostgres?: () => Promise<void>;
  checkRedis?: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    appConfig: {
      baseUrl: string;
      clock: () => Date;
      generateCode: () => string;
      cache: UrlCache;
      clicks: ClickCapture;
      rateLimiter: RateLimiter;
      rateLimits: RateLimitConfig;
    };
  }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const serverOptions: FastifyServerOptions = {
    genReqId: (req) => requestIdFromHeaders(req.headers),
    disableRequestLogging: true,
    logger: options.logger === false ? false : createLoggerOptions(process.env.LOG_LEVEL),
  };

  const app = Fastify(serverOptions);
  registerErrorHandler(app);
  const probes: ReadinessProbes = {
    postgres: options.checkPostgres,
    redis: options.checkRedis,
  };
  app.decorate('readinessProbes', probes);
  await app.register(healthRoutes);
  registerAccessLog(app);

  if (options.pool !== undefined) {
    if (options.baseUrl === undefined || options.baseUrl.length === 0) {
      throw new Error('baseUrl is required when a database pool is provided');
    }
    const pool = options.pool;
    const clock = options.clock ?? (() => new Date());
    const clicks =
      options.clicks ??
      new ClickCapture({
        salt: options.clickIpSalt ?? 'test-click-ip-salt',
        clock,
        counters: new MemoryClickCounters(),
        insert: (rows) => insertClickEvents(pool, rows),
        onError: (error) => {
          app.log.warn({ err: error }, 'click capture failed');
        },
      });
    app.decorate('db', options.pool);
    app.decorate('appConfig', {
      baseUrl: options.baseUrl,
      clock,
      // Keep generateCode on the config object. Fastify binds decorated
      // functions, which would swallow Vitest mocks used in collision tests.
      generateCode: options.generateCode ?? generateShortCode,
      cache: options.cache ?? new MemoryUrlCache(),
      clicks,
      rateLimiter: options.rateLimiter ?? new MemoryRateLimiter(clock),
      rateLimits: options.rateLimits ?? {
        createMax: RATE_LIMIT_IN_PROCESS_MAX,
        createWindowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        redirectMax: RATE_LIMIT_IN_PROCESS_MAX,
        redirectWindowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        ipPepper: RATE_LIMIT_IN_PROCESS_IP_PEPPER,
      },
    });
    app.addHook('onClose', async () => {
      await clicks.flush();
    });
    await app.register(urlRoutes, { prefix: '/api/v1' });
    await app.register(redirectRoutes);
  }

  return app;
}

function registerAccessLog(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    (request as { startedAtNs?: bigint }).startedAtNs = process.hrtime.bigint();
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    const started = (request as { startedAtNs?: bigint }).startedAtNs;
    const durationMs =
      started === undefined ? 0 : Number(process.hrtime.bigint() - started) / 1_000_000;
    request.log.info(
      accessLogFields({
        reqId: request.id,
        method: request.method,
        path: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(durationMs * 1_000) / 1_000,
      }),
      'request completed',
    );
    done();
  });
}
