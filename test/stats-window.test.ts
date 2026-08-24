import { describe, expect, it } from 'vitest';
import { STATS_DEFAULT_DAYS, STATS_MAX_DAYS } from '../src/lib/constants.js';
import { parseStatsDays } from '../src/services/stats.js';

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
