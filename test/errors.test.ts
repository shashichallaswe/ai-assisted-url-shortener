import { describe, expect, it } from 'vitest';
import { describeError } from '../src/lib/errors/describe.js';

describe('describeError', () => {
  it('uses the message of an ordinary error', () => {
    expect(describeError(new Error('connection refused'))).toBe('connection refused');
  });

  it('unwraps an AggregateError, which is what pg throws when a host is unreachable', () => {
    const aggregate = new AggregateError(
      [
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
        new Error('connect ECONNREFUSED ::1:5432'),
      ],
      '',
    );

    const described = describeError(aggregate);

    expect(described).toContain('127.0.0.1:5432');
    expect(described).toContain('::1:5432');
  });

  it('never returns an empty string, which tells an operator nothing', () => {
    expect(describeError(new Error(''))).not.toBe('');
    expect(describeError(new AggregateError([], ''))).not.toBe('');
    expect(describeError(undefined)).not.toBe('');
  });

  it('handles a thrown non-error', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
