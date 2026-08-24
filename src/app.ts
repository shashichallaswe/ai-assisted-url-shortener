import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { ClickCapture } from './analytics/click-capture.js';
import { MemoryClickCounters } from './cache/memory-click-counters.js';
import type { UrlCache } from './cache/url-cache.js';
import { MemoryUrlCache } from './cache/memory-url-cache.js';
import { generateShortCode } from './lib/codes.js';
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
    const clicks =
      options.clicks ??
      new ClickCapture({
        salt: options.clickIpSalt ?? 'test-click-ip-salt',
        clock: options.clock ?? (() => new Date()),
        counters: new MemoryClickCounters(),
        insert: (rows) => insertClickEvents(pool, rows),
        onError: (error) => {
          app.log.warn({ err: error }, 'click capture failed');
        },
      });
    app.decorate('db', options.pool);
    app.decorate('appConfig', {
      baseUrl: options.baseUrl,
      clock: options.clock ?? (() => new Date()),
      // Keep generateCode on the config object. Fastify binds decorated
      // functions, which would swallow Vitest mocks used in collision tests.
      generateCode: options.generateCode ?? generateShortCode,
      cache: options.cache ?? new MemoryUrlCache(),
      clicks,
    });
    app.addHook('onClose', async () => {
      await clicks.flush();
    });
    await app.register(urlRoutes, { prefix: '/api/v1' });
    await app.register(redirectRoutes);
  }

  return app;
}
