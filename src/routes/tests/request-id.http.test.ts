import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('x-request-id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes an inbound x-request-id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'inbound-trace-9' },
    });
    expect(response.headers['x-request-id']).toBe('inbound-trace-9');
  });

  it('assigns a request id when the client did not send one', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
  });
});
