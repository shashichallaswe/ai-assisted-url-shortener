import { describe, expect, it, vi } from 'vitest';
import { MemoryUrlCache } from '../src/cache/memory-url-cache.js';
import { HttpError } from '../src/lib/http-error.js';
import type { UrlRecord } from '../src/repos/urls.js';
import { resolveRedirect } from '../src/services/redirect.js';

const now = new Date('2026-08-23T12:00:00.000Z');

function liveRow(overrides: Partial<UrlRecord> = {}): UrlRecord {
  return {
    id: '1',
    code: 'aB3xY7z',
    destinationUrl: 'https://example.com/a',
    createdAt: now,
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('resolveRedirect', () => {
  it('does not query the database for a malformed code', async () => {
    const findByCode = vi.fn();
    const cache = new MemoryUrlCache();

    await expect(
      resolveRedirect({ clock: () => now, cache, findByCode }, 'nope'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findByCode).not.toHaveBeenCalled();
    expect(cache.gets).toBe(0);
  });

  it('does not query the database for a reserved path', async () => {
    const findByCode = vi.fn();
    await expect(
      resolveRedirect({ clock: () => now, cache: new MemoryUrlCache(), findByCode }, 'openapi'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findByCode).not.toHaveBeenCalled();
  });

  it('returns the destination and populates the cache on a miss', async () => {
    const row = liveRow();
    const findByCode = vi.fn().mockResolvedValue(row);
    const cache = new MemoryUrlCache();

    await expect(
      resolveRedirect({ clock: () => now, cache, findByCode }, row.code),
    ).resolves.toEqual({
      destinationUrl: row.destinationUrl,
      urlId: row.id,
      code: row.code,
    });
    expect(findByCode).toHaveBeenCalledTimes(1);
    expect(cache.sets).toBe(1);
  });

  it('serves the second lookup from cache without a database call', async () => {
    const row = liveRow();
    const findByCode = vi.fn().mockResolvedValue(row);
    const cache = new MemoryUrlCache();
    const deps = { clock: () => now, cache, findByCode };

    await resolveRedirect(deps, row.code);
    await expect(resolveRedirect(deps, row.code)).resolves.toMatchObject({
      destinationUrl: row.destinationUrl,
      urlId: row.id,
    });
    expect(findByCode).toHaveBeenCalledTimes(1);
    expect(cache.hits).toBe(1);
  });

  it('caches a miss as a negative entry so a repeat does not hit the database', async () => {
    const findByCode = vi.fn().mockResolvedValue(null);
    const cache = new MemoryUrlCache();
    const deps = { clock: () => now, cache, findByCode };

    await expect(resolveRedirect(deps, 'aB3xY7z')).rejects.toBeInstanceOf(HttpError);
    await expect(resolveRedirect(deps, 'aB3xY7z')).rejects.toBeInstanceOf(HttpError);
    expect(findByCode).toHaveBeenCalledTimes(1);
    expect(cache.negativeHits).toBe(1);
  });

  it('returns 404 for an expired mapping and does not cache it as live', async () => {
    const row = liveRow({ expiresAt: new Date('2026-08-23T11:00:00.000Z') });
    const findByCode = vi.fn().mockResolvedValue(row);
    const cache = new MemoryUrlCache();

    await expect(
      resolveRedirect({ clock: () => now, cache, findByCode }, row.code),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(cache.sets).toBe(0);
  });

  it('returns 404 when a stored destination would fail URL policy', async () => {
    const row = liveRow({ destinationUrl: 'javascript:alert(1)' });
    const findByCode = vi.fn().mockResolvedValue(row);

    await expect(
      resolveRedirect({ clock: () => now, cache: new MemoryUrlCache(), findByCode }, row.code),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findByCode).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a soft-deleted mapping', async () => {
    const row = liveRow({ deletedAt: now });
    const findByCode = vi.fn().mockResolvedValue(row);

    await expect(
      resolveRedirect({ clock: () => now, cache: new MemoryUrlCache(), findByCode }, row.code),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s an expired cache hit even if Redis still holds the entry', async () => {
    const row = liveRow({ expiresAt: new Date('2026-08-23T13:00:00.000Z') });
    const findByCode = vi.fn().mockResolvedValue(row);
    const cache = new MemoryUrlCache();
    const deps = { clock: () => now, cache, findByCode };

    await resolveRedirect(deps, row.code);
    await expect(
      resolveRedirect({ ...deps, clock: () => new Date('2026-08-23T14:00:00.000Z') }, row.code),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findByCode).toHaveBeenCalledTimes(1);
  });

  it('after invalidation, the next lookup hits the database again', async () => {
    const row = liveRow();
    const findByCode = vi.fn().mockResolvedValue(row);
    const cache = new MemoryUrlCache();
    const deps = { clock: () => now, cache, findByCode };

    await resolveRedirect(deps, row.code);
    await cache.del(row.code);
    await resolveRedirect(deps, row.code);
    expect(findByCode).toHaveBeenCalledTimes(2);
  });
});
