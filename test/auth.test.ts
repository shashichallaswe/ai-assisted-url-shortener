import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashApiKey, parseBearerToken } from '../src/security/auth.js';
import { HttpError } from '../src/lib/http-error.js';

describe('parseBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearerToken('Bearer secret-key')).toBe('secret-key');
  });

  it('accepts a case-insensitive scheme', () => {
    expect(parseBearerToken('bearer secret-key')).toBe('secret-key');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer ', 'Token abc', 'Bearer abc extra'])(
    'rejects %s',
    (header) => {
      expect(() => parseBearerToken(header)).toThrow(HttpError);
      try {
        parseBearerToken(header);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        if (error instanceof HttpError) {
          expect(error.statusCode).toBe(401);
          expect(error.code).toBe('unauthorized');
        }
      }
    },
  );
});

describe('hashApiKey', () => {
  it('returns a 32-byte SHA-256 digest', () => {
    const digest = hashApiKey('secret-key');

    expect(digest).toHaveLength(32);
    expect(digest.equals(createHash('sha256').update('secret-key', 'utf8').digest())).toBe(true);
  });

  it('is deterministic and sensitive to the input', () => {
    expect(hashApiKey('a').equals(hashApiKey('a'))).toBe(true);
    expect(hashApiKey('a').equals(hashApiKey('b'))).toBe(false);
  });
});
