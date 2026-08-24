import { describe, expect, it } from 'vitest';
import { createLoggerOptions, loggerOptions, serializeReply, serializeRequest } from '../logger.js';

describe('log serializers', () => {
  it('omits the client IP address, which AGENTS.md forbids logging raw', () => {
    const serialized = serializeRequest({
      id: 'req-1',
      method: 'GET',
      url: '/aB3xY7z',
      ip: '203.0.113.9',
      hostname: 'short.example',
    });

    expect(serialized).toStrictEqual({ id: 'req-1', method: 'GET', url: '/aB3xY7z' });
    expect(JSON.stringify(serialized)).not.toContain('203.0.113.9');
  });

  it('reduces a reply to its status code', () => {
    expect(serializeReply({ statusCode: 302 })).toStrictEqual({ statusCode: 302 });
  });

  it('takes the log level from configuration', () => {
    expect(createLoggerOptions('debug').level).toBe('debug');
  });

  it('removes the Authorization header rather than masking it', () => {
    // A masked value still records that a credential was present and how long
    // it was. Removal is the stated requirement.
    expect(loggerOptions.redact.paths).toContain('req.headers.authorization');
    expect(loggerOptions.redact.remove).toBe(true);
  });
});
