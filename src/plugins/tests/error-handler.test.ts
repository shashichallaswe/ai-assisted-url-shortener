import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('unhandled errors', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    app.get('/boom', async () => {
      throw new Error('internal detail must not leak');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a generic 500 body', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(response.json())).not.toContain('internal detail');
  });
});
