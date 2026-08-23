import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { loggerOptions } from './observability/logger.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  /** Set false to silence request logging, which tests do. */
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const serverOptions: FastifyServerOptions = {
    genReqId: () => randomUUID(),
    logger: options.logger === false ? false : loggerOptions,
  };

  const app = Fastify(serverOptions);

  await app.register(healthRoutes);

  return app;
}
