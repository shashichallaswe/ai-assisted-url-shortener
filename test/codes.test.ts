import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, generateShortCode, isWellFormedCode } from '../src/lib/codes.js';

describe('generateShortCode', () => {
  it('returns a 7-character base62 string', () => {
    const code = generateShortCode();

    expect(code).toHaveLength(CODE_LENGTH);
    expect(isWellFormedCode(code)).toBe(true);
  });

  it('does not produce obvious duplicates in a modest sample', () => {
    const sample = Array.from({ length: 200 }, () => generateShortCode());

    expect(new Set(sample).size).toBe(sample.length);
  });
});

describe('isWellFormedCode', () => {
  it.each(['aB3xY7z', '0000000', 'ZZZZZZZ'])('accepts %s', (code) => {
    expect(isWellFormedCode(code)).toBe(true);
  });

  it.each(['short', 'toolong1', 'abc_def', 'abc-def', ''])('rejects %s', (code) => {
    expect(isWellFormedCode(code)).toBe(false);
  });
});
