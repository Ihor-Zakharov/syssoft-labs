import { describe, expect, it, vi } from 'vitest';
import { EtagClient, GithubHttpError, parseRateLimit, type CachedResponse, type EtagCache } from './etag-client.js';

class MemoryCache implements EtagCache {
  readonly store = new Map<string, CachedResponse<unknown>>();
  async get<T>(url: string) {
    return (this.store.get(url) as CachedResponse<T> | undefined) ?? null;
  }
  async set<T>(url: string, value: CachedResponse<T>) {
    this.store.set(url, value);
  }
}

const rateHeaders = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': '1790000000' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('EtagClient', () => {
  it('caches mapped data with the ETag and sends If-None-Match next time', async () => {
    const cache = new MemoryCache();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [1, 2, 3] }, 200, { etag: '"v1"', ...rateHeaders }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: rateHeaders }));
    const client = new EtagClient({ fetch: fetchMock, cache, token: 't0ken', userAgent: 'test' });
    const map = (raw: { items: number[] }) => raw.items.length;

    const first = await client.getJson('/repos/a/b/commits', map);
    const second = await client.getJson('/repos/a/b/commits', map);

    expect(first).toMatchObject({ data: 3, changed: true, status: 200 });
    expect(second).toMatchObject({ data: 3, changed: false, status: 304 });
    expect(cache.store.get('https://api.github.com/repos/a/b/commits')).toEqual({ etag: '"v1"', data: 3 });

    const firstHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(firstHeaders['If-None-Match']).toBeUndefined();
    expect(firstHeaders.Authorization).toBe('Bearer t0ken');
    expect(secondHeaders['If-None-Match']).toBe('"v1"');
  });

  it('sends no Authorization header without a token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json([], 200));
    const client = new EtagClient({ fetch: fetchMock, cache: new MemoryCache(), userAgent: 'test' });

    await client.getJson('/x', (r: unknown[]) => r);

    expect(client.authenticated).toBe(false);
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('refreshes the cache when the resource changed', async () => {
    const cache = new MemoryCache();
    await cache.set('https://api.github.com/x', { etag: '"old"', data: 'old' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json('new', 200, { etag: '"new"' }));
    const client = new EtagClient({ fetch: fetchMock, cache, userAgent: 'test' });

    const result = await client.getJson('/x', (r: string) => r);

    expect(result).toMatchObject({ data: 'new', changed: true });
    expect(cache.store.get('https://api.github.com/x')).toEqual({ etag: '"new"', data: 'new' });
  });

  it('throws GithubHttpError with the rate limit on errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ message: 'API rate limit exceeded' }, 403, { ...rateHeaders, 'x-ratelimit-remaining': '0' }));
    const client = new EtagClient({ fetch: fetchMock, cache: new MemoryCache(), userAgent: 'test' });

    const error = await client.getJson('/x', (r) => r).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GithubHttpError);
    expect((error as GithubHttpError).status).toBe(403);
    expect((error as GithubHttpError).rateLimit?.remaining).toBe(0);
  });

  it('parses rate-limit headers', () => {
    expect(parseRateLimit(new Headers(rateHeaders))).toEqual({
      limit: 5000,
      remaining: 4990,
      resetAt: new Date(1790000000 * 1000).toISOString(),
    });
    expect(parseRateLimit(new Headers())).toBeNull();
  });
});
