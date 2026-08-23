import type { FastifyPluginCallback } from 'fastify';

/**
 * Liveness only. This route must never touch PostgreSQL or Redis: an orchestrator
 * uses it to decide whether to restart the process, and a dependency outage is
 * not a reason to do that. Readiness is a separate route (#16).
 */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/health', (_request, reply) => {
    reply.send({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  done();
};
