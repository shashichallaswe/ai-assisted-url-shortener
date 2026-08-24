import { describe, expect, it } from 'vitest';
import { requestIdFromHeaders } from '../request-id.js';

describe('requestIdFromHeaders', () => {
  it('honours a well-formed inbound x-request-id', () => {
    expect(requestIdFromHeaders({ 'x-request-id': 'trace-abc-1' })).toBe('trace-abc-1');
  });

  it('rejects an empty or oversized inbound value', () => {
    expect(requestIdFromHeaders({ 'x-request-id': '   ' })).not.toBe('   ');
    expect(requestIdFromHeaders({ 'x-request-id': 'x'.repeat(200) })).toHaveLength(36);
  });
});
