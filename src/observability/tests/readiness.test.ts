import { describe, expect, it } from 'vitest';
import { checkReadiness } from '../readiness.js';

describe('checkReadiness', () => {
  it('is ready when both probes succeed', async () => {
    await expect(
      checkReadiness({
        postgres: () => Promise.resolve(),
        redis: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ ready: true, postgres: 'ok', redis: 'ok' });
  });

  it('names postgres when that probe fails', async () => {
    await expect(
      checkReadiness({
        postgres: () => Promise.reject(new Error('ECONNREFUSED')),
        redis: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ ready: false, postgres: 'down', redis: 'ok' });
  });

  it('names redis when that probe fails', async () => {
    await expect(
      checkReadiness({
        postgres: () => Promise.resolve(),
        redis: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    ).resolves.toEqual({ ready: false, postgres: 'ok', redis: 'down' });
  });

  it('treats a missing probe as down', async () => {
    await expect(checkReadiness({})).resolves.toEqual({
      ready: false,
      postgres: 'down',
      redis: 'down',
    });
  });
});
