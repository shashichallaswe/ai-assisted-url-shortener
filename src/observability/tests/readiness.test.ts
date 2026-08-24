import { describe, expect, it } from 'vitest';
import { checkReadiness } from '../readiness.js';

describe('checkReadiness', () => {
  it('is ready when both probes succeed', async () => {
    await expect(
      checkReadiness({
        postgres: async () => undefined,
        redis: async () => undefined,
      }),
    ).resolves.toEqual({ ready: true, postgres: 'ok', redis: 'ok' });
  });

  it('names postgres when that probe fails', async () => {
    await expect(
      checkReadiness({
        postgres: async () => {
          throw new Error('ECONNREFUSED');
        },
        redis: async () => undefined,
      }),
    ).resolves.toEqual({ ready: false, postgres: 'down', redis: 'ok' });
  });

  it('names redis when that probe fails', async () => {
    await expect(
      checkReadiness({
        postgres: async () => undefined,
        redis: async () => {
          throw new Error('ECONNREFUSED');
        },
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
