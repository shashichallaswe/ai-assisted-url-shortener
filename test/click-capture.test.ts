import { describe, expect, it } from 'vitest';
import { ClickCapture } from '../src/analytics/click-capture.js';
import { MemoryClickCounters } from '../src/cache/memory-click-counters.js';
import { CLICK_TEXT_LIMIT } from '../src/lib/constants.js';
import { hashIp } from '../src/lib/ip-hash.js';
import type { DurableClick } from '../src/repos/click-events.js';

const salt = 'test-click-salt-16';
const at = new Date('2026-08-23T12:00:00.000Z');
const ip = '203.0.113.50';

function capture(
  insert: (rows: DurableClick[]) => Promise<void>,
  counters = new MemoryClickCounters(),
) {
  return new ClickCapture({
    salt,
    clock: () => at,
    counters,
    insert,
    onError: () => undefined,
  });
}

describe('ClickCapture', () => {
  it('hashes the IP, truncates UA and referrer, and increments the fast counter', async () => {
    const inserted: DurableClick[] = [];
    const counters = new MemoryClickCounters();
    const clicks = capture((rows) => {
      inserted.push(...rows);
      return Promise.resolve();
    }, counters);

    clicks.record({
      urlId: '42',
      code: 'aB3xY7z',
      ip,
      userAgent: 'a'.repeat(600),
      referrer: 'https://example.com/' + 'b'.repeat(600),
      at,
    });
    await clicks.flush();

    expect(counters.total('aB3xY7z')).toBe(1);
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row?.urlId).toBe('42');
    expect(row?.ipHash.equals(hashIp(ip, salt, at))).toBe(true);
    expect(row?.userAgent).toHaveLength(CLICK_TEXT_LIMIT);
    expect(row?.referrer).toHaveLength(CLICK_TEXT_LIMIT);
    expect(JSON.stringify(inserted)).not.toContain(ip);
  });

  it('does not throw when the durable write fails', async () => {
    const clicks = capture(() => Promise.reject(new Error('postgres unavailable')));

    expect(() => {
      clicks.record({ urlId: '1', code: 'aB3xY7z', ip, userAgent: 'ua', referrer: undefined, at });
    }).not.toThrow();
    await clicks.flush();
  });

  it('does not throw when the counter increment fails', async () => {
    const counters = {
      increment: () => Promise.reject(new Error('redis unavailable')),
      total: () => 0,
    };
    const inserted: DurableClick[] = [];
    const clicks = new ClickCapture({
      salt,
      clock: () => at,
      counters,
      insert: (rows) => {
        inserted.push(...rows);
        return Promise.resolve();
      },
      onError: () => undefined,
    });

    clicks.record({
      urlId: '1',
      code: 'aB3xY7z',
      ip,
      userAgent: undefined,
      referrer: undefined,
      at,
    });
    await clicks.flush();
    expect(inserted).toHaveLength(1);
  });
});
