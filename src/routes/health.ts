import type { FastifyPluginCallback } from 'fastify';
import { checkReadiness, type ReadinessProbes } from '../observability/readiness.js';

/**
 * Liveness must never touch PostgreSQL or Redis: an orchestrator uses it to
 * decide whether to restart the process. Readiness is /ready.
 */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/health', (_request, reply) => {
    reply.send({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.get('/ready', async (_request, reply) => {
    const probes = app.readinessProbes ?? {};
    const report = await checkReadiness(probes);
    const status = report.ready ? 'ready' : 'not_ready';
    return reply.status(report.ready ? 200 : 503).send({
      status,
      postgres: report.postgres,
      redis: report.redis,
    });
  });

  done();
};

declare module 'fastify' {
  interface FastifyInstance {
    readinessProbes?: ReadinessProbes;
  }
}
