import type { FastifyPluginCallback } from 'fastify';
import { firstHeader } from '../lib/headers.js';
import { findUrlByCode } from '../repos/urls.js';
import { resolveRedirect } from '../services/redirect.js';

export const redirectRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/:code', async (request, reply) => {
    const hit = await resolveRedirect(
      {
        clock: app.appConfig.clock,
        cache: app.appConfig.cache,
        findByCode: (code) => findUrlByCode(app.db, code),
      },
      (request.params as { code: string }).code,
    );

    app.appConfig.clicks.record({
      urlId: hit.urlId,
      code: hit.code,
      ip: request.ip,
      userAgent: firstHeader(request.headers['user-agent']),
      referrer: firstHeader(request.headers.referer),
      at: app.appConfig.clock(),
    });

    return reply
      .status(302)
      .header('Location', hit.destinationUrl)
      .header('Cache-Control', 'private, no-store')
      .send();
  });
  done();
};
