import { describe, expect, it } from 'vitest';
import { STATS_DEFAULT_DAYS, STATS_MAX_DAYS } from '../src/lib/constants.js';
import { parseStatsDays, statsWindowStart } from '../src/services/stats.js';

describe('parseStatsDays', () => {
  it('defaults to 30 days when the query is omitted', () => {
    expect(parseStatsDays(undefined)).toBe(STATS_DEFAULT_DAYS);
  });

  it('accepts an integer inside the documented bounds', () => {
    expect(parseStatsDays('7')).toBe(7);
  });

  it.each(['0', '91', 'nope', '1.5', ''])('rejects %s', (value) => {
    expect(() => parseStatsDays(value)).toThrow(/days/i);
  });

  it('caps the documented maximum at 90', () => {
    expect(STATS_MAX_DAYS).toBe(90);
  });
});

describe('statsWindowStart', () => {
  const now = new Date('2026-03-15T18:42:07.123Z');

  it('includes today when the window is one day', () => {
    expect(statsWindowStart(1, now).toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('counts back in whole UTC days, inclusive of today', () => {
    expect(statsWindowStart(30, now).toISOString()).toBe('2026-02-14T00:00:00.000Z');
  });

  it('does not shift with the local timezone of the process', () => {
    expect(statsWindowStart(7, new Date('2026-01-01T00:30:00.000Z')).toISOString()).toBe(
      '2025-12-26T00:00:00.000Z',
    );
  });
});
