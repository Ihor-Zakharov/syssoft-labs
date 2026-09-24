import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, databaseUrlFromEnv, runMigrations } from './connections.js';
import { commitAreaCondition, pageQuery } from './paging.js';

// Runs against a real Postgres when one is configured (POSTGRES_PASSWORD or DATABASE_URL); every test
// runs in a transaction that is rolled back.
const configured = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD);
const REPO = 'test/paging-fixture';

describe.skipIf(!configured)('anchored paging (Postgres)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const url = databaseUrlFromEnv();
    const handle = createDb(url);
    await runMigrations(handle.db);
    await handle.pool.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });
  afterAll(async () => client?.end());
  beforeEach(async () => client.query('begin'));
  afterEach(async () => client.query('rollback'));

  async function run(id: number, at: string) {
    await client.query(
      `insert into ci_runs (id, repo, workflow_name, run_number, run_attempt, branch, head_sha, event, status, conclusion, title, html_url, created_at, updated_at)
       values ($1, $2, 'CI', $4, 1, 'main', 'x', 'push', 'completed', 'success', 't', 'u', $3, $3)`,
      [id, REPO, at, id % 100000],
    );
  }

  const page = (n: number, anchor: { at: string; key: string } | null) =>
    pageQuery<{ id: string }>(client, {
      from: 'ci_runs',
      select: 'id',
      where: 'repo = $1',
      params: [REPO],
      timeCol: 'created_at',
      keyCol: 'id',
      keyType: 'bigint',
      page: n,
      pageSize: 15,
      anchor,
    });

  it('keeps pages stable while new rows arrive and counts them', async () => {
    // 40 runs one minute apart, plus one sharing a timestamp (the key breaks the tie)
    for (let i = 1; i <= 40; i++) await run(800000 + i, new Date(Date.UTC(2026, 8, 24, 10, i)).toISOString());
    await run(800100, new Date(Date.UTC(2026, 8, 24, 10, 30)).toISOString());

    const first = await page(1, null);
    expect(first).toMatchObject({ total: 41, page: 1, pageSize: 15, newer: 0 });
    expect(first.rows[0]!.id).toBe('800040');
    expect(first.anchor?.key).toBe('800040');

    const second = await page(2, first.anchor);
    const ids = second.rows.map((r) => r.id);
    expect(ids).toHaveLength(15);
    expect(new Set([...first.rows.map((r) => r.id), ...ids]).size).toBe(30); // no overlap

    // Two new runs arrive: page 2 (same anchor) does not move, "2 new" is reported
    await run(800200, '2026-09-24T12:00:00Z');
    await run(800201, '2026-09-24T12:01:00Z');
    const again = await page(2, first.anchor);
    expect(again.rows.map((r) => r.id)).toEqual(ids);
    expect(again).toMatchObject({ total: 41, newer: 2 });

    // Back to the latest: page 1 without an anchor shows them
    const latest = await page(1, null);
    expect(latest.rows.slice(0, 2).map((r) => r.id)).toEqual(['800201', '800200']);
    expect(latest).toMatchObject({ total: 43, newer: 0 });

    // Past the end → clamped to the last, short page
    expect(await page(9, first.anchor)).toMatchObject({ page: 3 });
    expect((await page(3, first.anchor)).rows).toHaveLength(11);
  });

  it('compares bigint keys as numbers, not as text', async () => {
    // Same timestamp: 9 and 10 must order as numbers (10 is newer), "9" > "10" as text would break it
    await run(9, '2026-09-24T10:00:00Z');
    await run(10, '2026-09-24T10:00:00Z');
    const first = await page(1, null);
    expect(first.rows.map((r) => r.id)).toEqual(['10', '9']);
    expect(first.anchor?.key).toBe('10');
    expect(await page(1, first.anchor)).toMatchObject({ total: 2, newer: 0 });
  });

  it('returns an empty page without rows', async () => {
    expect(await page(1, null)).toEqual({ rows: [], total: 0, page: 1, pageSize: 15, anchor: null, newer: 0 });
  });

  it('filters commits by area through their changed files', async () => {
    const commit = async (sha: string, minute: number, paths: string[]) => {
      await client.query(
        `insert into commits (sha, repo, message, html_url, verified, committed_at) values ($1, $2, 'm', 'u', false, $3)`,
        [sha, REPO, new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString()],
      );
      await client.query(
        `insert into commit_details (sha, repo, fetched_at, file_count, truncated) values ($1, $2, now(), $3, false)`,
        [sha, REPO, paths.length],
      );
      for (const path of paths) await client.query(`insert into commit_files (sha, path) values ($1, $2)`, [sha, path]);
    };
    await commit('aaa1', 1, ['Lab1/Task1/Program.cs']);
    await commit('aaa2', 2, ['labwatch/README.md', '.github/workflows/ci.yml']);
    await commit('aaa3', 3, ['README.md']);
    await commit('aaa4', 4, ['Lab12/x.cs']);

    const shasFor = async (area: string) => {
      const cond = commitAreaCondition(area, 'commits.sha', 2);
      const result = await pageQuery<{ sha: string }>(client, {
        from: 'commits',
        select: 'sha',
        where: `repo = $1 and ${cond.sql}`,
        params: [REPO, ...cond.params],
        timeCol: 'committed_at',
        keyCol: 'sha',
        keyType: 'text',
        page: 1,
        pageSize: 15,
        anchor: null,
      });
      return result.rows.map((r) => r.sha);
    };
    expect(await shasFor('Lab 1')).toEqual(['aaa1']); // not Lab12
    expect(await shasFor('Lab 12')).toEqual(['aaa4']);
    expect(await shasFor('Infra')).toEqual(['aaa2']);
    expect(await shasFor('CI')).toEqual(['aaa2']);
    expect(await shasFor('Repo')).toEqual(['aaa3']);
    expect(await shasFor('Nonsense')).toEqual([]);
  });
});
