import type { FastifyPluginCallback } from 'fastify';
import { findUrlByCode } from '../repos/urls.js';
import { resolveRedirect } from '../services/redirect.js';

export const redirectRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/:code', async (request, reply) => {
    const destinationUrl = await resolveRedirect(
      {
        clock: app.appConfig.clock,
        cache: app.appConfig.cache,
        findByCode: (code) => findUrlByCode(app.db, code),
      },
      (request.params as { code: string }).code,
    );

    return reply
      .status(302)
      .header('Location', destinationUrl)
      .header('Cache-Control', 'private, no-store')
      .send();
  });
  done();
};
