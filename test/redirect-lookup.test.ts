import { describe, expect, it } from 'vitest';
import { redirectDecision } from '../src/lib/redirect-decision.js';

describe('redirectDecision', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  it('redirects a live mapping', () => {
    expect(
      redirectDecision(
        {
          destinationUrl: 'https://example.com/a',
          expiresAt: new Date('2026-08-24T00:00:00.000Z'),
          deletedAt: null,
        },
        now,
      ),
    ).toStrictEqual({ ok: true, destinationUrl: 'https://example.com/a' });
  });

  it('returns not-found when the mapping is expired, including at the exact instant', () => {
    expect(
      redirectDecision(
        {
          destinationUrl: 'https://example.com/a',
          expiresAt: now,
          deletedAt: null,
        },
        now,
      ),
    ).toStrictEqual({ ok: false });
  });

  it('returns not-found when the mapping is soft-deleted', () => {
    expect(
      redirectDecision(
        {
          destinationUrl: 'https://example.com/a',
          expiresAt: null,
          deletedAt: now,
        },
        now,
      ),
    ).toStrictEqual({ ok: false });
  });
});
