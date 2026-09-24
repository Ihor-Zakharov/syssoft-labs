import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createDb, databaseUrlFromEnv, runMigrations } from './connections.js';
import { latestChecks, recentIncidents, totalUptime, uptimeBuckets } from './status-queries.js';

// Runs against a real Postgres when one is configured (POSTGRES_PASSWORD or DATABASE_URL):
// locally the compose database, in CI a service container. Every test runs in a transaction
// that is rolled back, so nothing is left behind.
const configured = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD);

describe.skipIf(!configured)('status queries (Postgres)', () => {
  let client: pg.Client;
  const target = `test-${randomUUID()}`;
  const vantage = 'test';
  // A fixed "now" in the middle of a local (Europe/Kyiv, UTC+3 in September) day
  const now = new Date('2026-09-24T12:30:30Z');
  const tz = 'Europe/Kyiv';

  beforeAll(async () => {
    const url = databaseUrlFromEnv();
    const handle = createDb(url);
    await runMigrations(handle.db);
    await handle.pool.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query('begin');
  });

  afterEach(async () => {
    await client.query('rollback');
  });

  async function insert(at: string, outcome: string, latency: number | null) {
    await client.query(
      `insert into status_checks (target, vantage, checked_at, outcome, http_status, latency_ms, tls_ok)
       values ($1, $2, $3, $4, 200, $5, false)`,
      [target, vantage, at, outcome, latency],
    );
  }

  it('builds a full 1h frame of minute buckets with aggregates', async () => {
    await insert('2026-09-24T12:30:05Z', 'operational', 100);
    await insert('2026-09-24T12:30:20Z', 'degraded', 2500);
    await insert('2026-09-24T12:30:25Z', 'down', null);
    await insert('2026-09-24T12:29:10Z', 'operational', 300);
    await insert('2026-09-24T11:00:00Z', 'down', null); // outside the hour

    const buckets = (await uptimeBuckets(client, { targets: [target], vantage, scale: '1h', timezone: tz, now })).get(target)!;

    expect(buckets).toHaveLength(60);
    const last = buckets.at(-1)!;
    expect(last.start).toBe('2026-09-24T12:30:00.000Z');
    expect(last.end).toBe('2026-09-24T12:31:00.000Z');
    expect(last).toMatchObject({ total: 3, up: 2, degraded: 1, down: 1, avgLatencyMs: 1300 });
    expect(last.uptime).toBeCloseTo(2 / 3);
    expect(buckets.at(-2)).toMatchObject({ total: 1, up: 1, uptime: 1, avgLatencyMs: 300, p95LatencyMs: 300 });
    expect(buckets[0]!.start).toBe('2026-09-24T11:31:00.000Z');
    expect(buckets.slice(0, 58).every((b) => b.total === 0 && b.uptime === null)).toBe(true);
    // contiguous buckets
    for (let i = 1; i < buckets.length; i++) expect(buckets[i]!.start).toBe(buckets[i - 1]!.end);
    expect(totalUptime(buckets)).toBeCloseTo(3 / 4);
  });

  it('aligns day buckets to local midnight', async () => {
    await insert('2026-09-23T21:10:00Z', 'operational', 50); // 00:10 local on the 24th
    await insert('2026-09-23T20:50:00Z', 'down', null); // 23:50 local on the 23rd

    const buckets = (await uptimeBuckets(client, { targets: [target], vantage, scale: '30d', timezone: tz, now })).get(target)!;

    expect(buckets).toHaveLength(30);
    expect(buckets.at(-1)).toMatchObject({ start: '2026-09-23T21:00:00.000Z', end: '2026-09-24T21:00:00.000Z', total: 1, up: 1 });
    expect(buckets.at(-2)).toMatchObject({ total: 1, down: 1, uptime: 0 });
  });

  it('computes p95 and 15-minute buckets for 24h', async () => {
    for (let i = 1; i <= 20; i++) await insert(`2026-09-24T12:${String(15 + (i % 15)).padStart(2, '0')}:00Z`, 'operational', i * 10);

    const buckets = (await uptimeBuckets(client, { targets: [target], vantage, scale: '24h', timezone: tz, now })).get(target)!;

    expect(buckets).toHaveLength(96);
    const last = buckets.at(-1)!;
    expect(last.start).toBe('2026-09-24T12:30:00.000Z');
    const previous = buckets.at(-2)!;
    expect(previous.start).toBe('2026-09-24T12:15:00.000Z');
    expect(previous.total).toBe(20);
    expect(previous.p95LatencyMs).toBe(191); // percentile_cont of 10..200, rounded
  });

  it('returns the latest check per target and incidents', async () => {
    await insert('2026-09-24T12:00:00Z', 'down', null);
    await insert('2026-09-24T12:01:00Z', 'operational', 42);
    await client.query(
      `insert into status_incidents (target, vantage, started_at, resolved_at, failed_checks, last_error)
       values ($1, $2, '2026-09-24T11:50:00Z', '2026-09-24T12:01:00Z', 11, 'timeout')`,
      [target, vantage],
    );

    const latest = await latestChecks(client, [target, 'missing'], vantage);
    expect(latest.get(target)).toMatchObject({ outcome: 'operational', latencyMs: 42, tlsOk: false });
    expect(latest.has('missing')).toBe(false);

    const incidents = await recentIncidents(client, { vantage, limit: 5, names: new Map([[target, 'Test site']]), now });
    expect(incidents).toEqual([
      expect.objectContaining({ targetName: 'Test site', durationS: 660, failedChecks: 11, lastError: 'timeout' }),
    ]);
  });

  it('allows only one open incident per target', async () => {
    const open = `insert into status_incidents (target, vantage, started_at) values ($1, $2, now()) on conflict do nothing returning id`;
    expect((await client.query(open, [target, vantage])).rows).toHaveLength(1);
    expect((await client.query(open, [target, vantage])).rows).toHaveLength(0);
  });
});
