import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { ClickCapture } from './analytics/click-capture.js';
import { MemoryClickCounters } from './cache/memory-click-counters.js';
import type { UrlCache } from './cache/url-cache.js';
import { MemoryRateLimiter } from './cache/memory-rate-limiter.js';
import { MemoryUrlCache } from './cache/memory-url-cache.js';
import { generateShortCode } from './lib/codes.js';
import type { RateLimitConfig, RateLimiter } from './security/rate-limit.js';
import { insertClickEvents } from './repos/click-events.js';
import { loggerOptions } from './observability/logger.js';
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
    genReqId: () => randomUUID(),
    logger: options.logger === false ? false : loggerOptions,
  };

  const app = Fastify(serverOptions);
  registerErrorHandler(app);
  await app.register(healthRoutes);

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
        createMax: 10_000,
        createWindowSeconds: 60,
        redirectMax: 10_000,
        redirectWindowSeconds: 60,
        ipPepper: 'test-rate-limit-pepper',
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
