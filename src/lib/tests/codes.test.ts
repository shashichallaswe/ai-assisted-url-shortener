import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, generateShortCode, isReservedCode, isWellFormedCode } from '../codes.js';

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

describe('isReservedCode', () => {
  it.each(['health', 'ready', 'api', 'openapi', 'favicon', 'HEALTH', 'OpenAPI'])(
    'treats %s as reserved',
    (code) => {
      expect(isReservedCode(code)).toBe(true);
    },
  );

  it('does not treat a well-formed generated code as reserved', () => {
    expect(isReservedCode('aB3xY7z')).toBe(false);
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
