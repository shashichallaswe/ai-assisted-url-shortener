import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /ready', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  it('returns 200 when both dependencies report ok', async () => {
    app = await buildApp({
      logger: false,
      checkPostgres: () => Promise.resolve(),
      checkRedis: () => Promise.resolve(),
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', postgres: 'ok', redis: 'ok' });
  });

  it('returns 503 naming postgres when that check fails', async () => {
    app = await buildApp({
      logger: false,
      checkPostgres: () => Promise.reject(new Error('ECONNREFUSED')),
      checkRedis: () => Promise.resolve(),
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', postgres: 'down', redis: 'ok' });
  });

  it('returns 503 naming redis when that check fails', async () => {
    app = await buildApp({
      logger: false,
      checkPostgres: () => Promise.resolve(),
      checkRedis: () => Promise.reject(new Error('NOAUTH')),
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', postgres: 'ok', redis: 'down' });
  });

  it('does not change /health when a dependency is down', async () => {
    app = await buildApp({
      logger: false,
      checkPostgres: () => Promise.reject(new Error('down')),
    });
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
  });
});
