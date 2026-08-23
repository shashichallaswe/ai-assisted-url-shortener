import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envSchema, parseEnv } from '../src/config/env.js';

const validEnv = {
  BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://shortener:shortener@localhost:5432/shortener',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv(validEnv);

    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('names the missing variable rather than failing vaguely', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = validEnv;

    expect(() => parseEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseEnv({ ...validEnv, PORT: 'eight thousand' })).toThrow(/PORT/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => parseEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects a malformed database URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('coerces PORT from the string the environment always supplies', () => {
    expect(parseEnv({ ...validEnv, PORT: '8080' }).PORT).toBe(8080);
  });
});

describe('.env.example', () => {
  it('documents every variable the schema knows about', () => {
    const contents = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const documented = contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('=')[0]?.trim());

    for (const key of Object.keys(envSchema.shape)) {
      expect(documented).toContain(key);
    }
  });

  it('holds placeholders only, never a real-looking credential', () => {
    const contents = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

    expect(contents).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(contents).not.toMatch(/\bgh[pousr]_[A-Za-z0-9]{30,}/);
    expect(contents).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/);
  });
});
