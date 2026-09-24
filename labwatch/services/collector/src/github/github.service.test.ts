import 'reflect-metadata';
import { integrationLevel, RedisKeys } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { GithubHttpError } from '../logic/etag-client.js';
import { githubConnection } from '../logic/integrations.js';
import { GithubService } from './github.service.js';

/** Just enough of ioredis for the service: strings and sorted sets in memory. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();
  const redis = {
    strings,
    zsets,
    get: async (k: string) => strings.get(k) ?? null,
    set: async (k: string, v: string) => {
      strings.set(k, v);
      return 'OK';
    },
    zadd: async (k: string, score: number, member: string) => {
      zsets.set(k, [...(zsets.get(k) ?? []), { score, member }]);
      return 1;
    },
    zremrangebyscore: async (k: string, _min: string, max: number) => {
      zsets.set(k, (zsets.get(k) ?? []).filter((e) => e.score > max));
      return 0;
    },
    zrangebyscore: async (k: string, min: number) =>
      (zsets.get(k) ?? []).filter((e) => e.score >= min).flatMap((e) => [e.member, String(e.score)]),
  };
  return redis;
}

const env = {
  POSTGRES_PASSWORD: 'x',
  REDIS_PASSWORD: 'x',
  GITHUB_TOKEN: 'test-token-not-real',
  GITHUB_UNAUTH_BUDGET_PER_HOUR: '40',
  GITHUB_AUTH_BUDGET_PER_HOUR: '2000',
};

const rate = (remaining: number, limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
});

afterEach(() => vi.unstubAllGlobals());

describe('GithubService when the token is revoked', () => {
  it('degrades to anonymous mode with the anonymous budget and reports an auth error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401, headers: rate(0, 60) }))
      .mockResolvedValue(new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { etag: '"a"', ...rate(59, 60) } }));
    vi.stubGlobal('fetch', fetchMock);
    const redis = fakeRedis();
    const service = new GithubService(loadConfig(env), redis as unknown as Redis);
    await service.onModuleInit();

    expect(service.authenticated).toBe(true);
    expect(service.budget.budgetPerHour).toBe(2000);

    // The first call is rejected: the error still reaches the caller, the service switches mode
    await expect(service.runs('o/r')).rejects.toBeInstanceOf(GithubHttpError);
    expect(service.authenticated).toBe(false);
    expect(service.isTokenRejected).toBe(true);
    expect(service.budget.budgetPerHour).toBe(40);
    expect(JSON.parse(redis.strings.get(RedisKeys.apiBudget)!)).toMatchObject({ authenticated: false, budgetPerHour: 40, tokenRejected: true });

    // Later calls go out without the token and count against the anonymous window
    await service.runs('o/r');
    const headers = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(service.budget.used()).toBe(1);
    expect(redis.zsets.get(RedisKeys.apiRequests(false))).toHaveLength(1);
    expect(redis.zsets.get(RedisKeys.apiRequests(true))).toHaveLength(1); // the rejected call

    // The GitHub card: red "Auth error" although calls succeed anonymously
    const ours = githubConnection({
      tokenConfigured: service.tokenConfigured,
      tokenRejected: service.isTokenRejected,
      authenticated: service.authenticated,
      stats: service.stats(),
      budget: service.rateLimitSnapshot(),
    });
    expect(ours).toMatchObject({ state: 'auth_error' });
    expect(ours.summary).toContain('401');
    expect(ours.hint).toContain('docker compose up -d collector');
    expect(integrationLevel(ours, null)).toEqual({ level: 'error', label: 'Auth error' });
  });

  it('keeps an anonymous service anonymous on 401 (nothing to degrade)', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401, headers: rate(10, 60) })));
    const service = new GithubService(loadConfig({ ...env, GITHUB_TOKEN: '' }), fakeRedis() as unknown as Redis);
    await service.onModuleInit();
    await expect(service.runs('o/r')).rejects.toBeInstanceOf(GithubHttpError);
    expect(service.isTokenRejected).toBe(false);
    expect(service.budget.budgetPerHour).toBe(40);
  });
});

describe('githubConnection', () => {
  const budget = { used: 3, budgetPerHour: 2000, remote: { limit: 5000, remaining: 4990, resetAt: '2026-09-24T14:09:00Z' } };
  const stats = (o: Partial<Parameters<typeof githubConnection>[0]['stats']> = {}) => ({
    avgLatencyMs: 300,
    calls: 10,
    lastOkAt: '2026-09-24T13:00:00Z',
    lastError: null,
    ...o,
  });

  it('describes a healthy, a slow, an unreachable and an anonymous connection', () => {
    const ok = githubConnection({ tokenConfigured: true, tokenRejected: false, authenticated: true, stats: stats(), budget });
    expect(ok).toMatchObject({ state: 'connected', summary: 'Authenticated API access', hint: null });
    expect(ok.facts.find((f) => f.label === 'Rate limit')?.value).toBe('4990/5000 left, resets 14:09 UTC');
    expect(githubConnection({ tokenConfigured: true, tokenRejected: false, authenticated: true, stats: stats({ avgLatencyMs: 2500 }), budget }).state).toBe('slow');
    expect(
      githubConnection({
        tokenConfigured: true,
        tokenRejected: false,
        authenticated: true,
        stats: stats({ lastError: { at: 'x', status: null, message: 'fetch failed' } }),
        budget,
      }),
    ).toMatchObject({ state: 'unreachable', summary: 'Last call failed: fetch failed' });
    const anonymous = githubConnection({ tokenConfigured: false, tokenRejected: false, authenticated: false, stats: stats(), budget: { ...budget, budgetPerHour: 40 } });
    expect(anonymous).toMatchObject({ state: 'connected', summary: 'Anonymous API access (40 requests/hour budget)' });
    expect(anonymous.hint).toContain('GITHUB_TOKEN');
  });
});
