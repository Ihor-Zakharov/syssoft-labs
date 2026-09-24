import { describe, expect, it } from 'vitest';
import { areaForPath, areasForPaths, compareAreas, labNumber, labNumberFromDir } from './areas.js';
import { ciStateOf, latestPerWorkflow, type RunLike } from './ci.js';
import { overallStatus, worstLevel } from './overall.js';
import { aggregateReviewState, countFindings, reviewRunOutcome } from './reviews.js';
import {
  STATUS_SCALES,
  currentOutcome,
  formatUptime,
  isStatusScale,
  statusLevel,
  uptimeRatio,
  uptimeTone,
  type LatestCheck,
} from './status.js';
import { arrangeBranchTabs, type BranchTabInfo } from './tabs.js';

describe('areas (path → lab attribution)', () => {
  it('maps paths to areas', () => {
    expect(areaForPath('Lab1/Task1/Program.cs')).toBe('Lab 1');
    expect(areaForPath('Lab12/x')).toBe('Lab 12');
    expect(areaForPath('Lab03/x')).toBe('Lab 3');
    expect(areaForPath('labwatch/compose.yaml')).toBe('Infra');
    expect(areaForPath('.github/workflows/ci.yml')).toBe('CI');
    expect(areaForPath('README.md')).toBe('Repo');
    expect(areaForPath('Lab1')).toBe('Repo'); // a file named Lab1, not the directory
    expect(areaForPath('lab1/x')).toBe('Repo'); // case-sensitive
    expect(areaForPath('docs/Lab1/x')).toBe('Repo'); // only top-level
  });

  it('gives a commit several distinct areas in display order', () => {
    expect(areasForPaths(['README.md', 'Lab2/a', '.github/w.yml', 'Lab1/b', 'Lab1/c', 'labwatch/x'])).toEqual([
      'Lab 1',
      'Lab 2',
      'Infra',
      'CI',
      'Repo',
    ]);
    expect(areasForPaths([])).toEqual([]);
    expect(['Repo', 'Lab 10', 'CI', 'Lab 9'].sort(compareAreas)).toEqual(['Lab 9', 'Lab 10', 'CI', 'Repo']);
  });

  it('parses lab numbers', () => {
    expect(labNumber('Lab 4')).toBe(4);
    expect(labNumber('Infra')).toBeNull();
    expect(labNumberFromDir('Lab4')).toBe(4);
    expect(labNumberFromDir('Lab4.md')).toBeNull();
    expect(labNumberFromDir('labwatch')).toBeNull();
  });
});

describe('CI state', () => {
  const run = (o: Partial<RunLike>): RunLike => ({
    workflowName: 'CI',
    runNumber: 1,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'success',
    ...o,
  });

  it('combines runs of one commit: red wins, then running, then green', () => {
    expect(ciStateOf([])).toBe('none');
    expect(ciStateOf([run({})])).toBe('success');
    expect(ciStateOf([run({}), run({ workflowName: 'Review', status: 'in_progress', conclusion: null })])).toBe('running');
    expect(ciStateOf([run({ conclusion: 'failure' }), run({ workflowName: 'Review', status: 'queued', conclusion: null })])).toBe(
      'failure',
    );
    expect(ciStateOf([run({ conclusion: 'cancelled' })])).toBe('none');
  });

  it('uses the newest attempt of a re-run', () => {
    const runs = [run({ conclusion: 'failure' }), run({ runAttempt: 2, conclusion: 'success' })];
    expect(latestPerWorkflow(runs)).toHaveLength(1);
    expect(ciStateOf(runs)).toBe('success');
  });
});

describe('branch tabs', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const tab = (name: string, daysAgo: number | null, o: Partial<BranchTabInfo> = {}): BranchTabInfo => ({
    name,
    isDefault: false,
    lastActivityAt: daysAgo === null ? null : new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    merged: false,
    ciState: 'none',
    ...o,
  });

  it('pins the default branch, sorts by activity and overflows merged and idle branches', () => {
    const { visible, overflow } = arrangeBranchTabs(
      [
        tab('old', 20),
        tab('b', 2),
        tab('main', 30, { isDefault: true }),
        tab('a', 0.1),
        tab('done', 0.5, { merged: true }),
        tab('never', null),
        tab('c', 2),
      ],
      now,
    );
    expect(visible.map((t) => t.name)).toEqual(['main', 'a', 'b', 'c']);
    expect(overflow.map((t) => t.name)).toEqual(['done', 'old', 'never']);
  });

  it('keeps a branch idle for exactly the limit visible', () => {
    expect(arrangeBranchTabs([tab('edge', 14)], now).visible.map((t) => t.name)).toEqual(['edge']);
    expect(arrangeBranchTabs([tab('edge', 14.01)], now).overflow.map((t) => t.name)).toEqual(['edge']);
  });
});

describe('status page', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const check = (outcome: LatestCheck['outcome'], secondsAgo = 30): LatestCheck => ({
    outcome,
    checkedAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
  });

  it('computes the banner level', () => {
    expect(statusLevel([], now)).toBe('no_data');
    expect(statusLevel([null, null], now)).toBe('no_data');
    expect(statusLevel([check('down', 600)], now)).toBe('no_data'); // stale: grey, never red
    expect(statusLevel([check('operational'), check('operational')], now)).toBe('operational');
    expect(statusLevel([check('operational'), check('degraded')], now)).toBe('degraded');
    expect(statusLevel([check('down'), check('operational'), check('operational'), check('operational')], now)).toBe('partial_outage');
    expect(statusLevel([check('down'), check('down'), check('operational'), check('degraded')], now)).toBe('partial_outage');
    expect(statusLevel([check('down'), check('down'), check('down'), check('operational')], now)).toBe('major_outage');
    expect(statusLevel([check('down')], now)).toBe('major_outage');
    // stale targets are ignored, not counted as down
    expect(statusLevel([check('down'), check('operational', 900), check('operational')], now)).toBe('partial_outage');
  });

  it('reports no data for stale targets', () => {
    expect(currentOutcome(check('degraded', 60), now)).toBe('degraded');
    expect(currentOutcome(check('operational', 200), now)).toBe('no_data');
    expect(currentOutcome(null, now)).toBe('no_data');
  });

  it('defines scales that cover their period exactly', () => {
    const hours = (s: keyof typeof STATUS_SCALES) => (STATUS_SCALES[s].buckets * STATUS_SCALES[s].bucketSeconds) / 3600;
    expect(hours('1h')).toBe(1);
    expect(hours('24h')).toBe(24);
    expect(hours('7d')).toBe(7 * 24);
    expect(hours('30d')).toBe(30 * 24);
    expect(hours('90d')).toBe(90 * 24);
    expect(STATUS_SCALES['24h'].buckets).toBe(96);
    expect(isStatusScale('7d')).toBe(true);
    expect(isStatusScale('2d')).toBe(false);
  });

  it('colours uptime', () => {
    expect(uptimeRatio(0, 0)).toBeNull();
    expect(uptimeTone(null)).toBe('none');
    expect(uptimeTone(1)).toBe('great');
    expect(uptimeTone(0.999)).toBe('great');
    expect(uptimeTone(0.995)).toBe('good');
    expect(uptimeTone(0.96)).toBe('fair');
    expect(uptimeTone(0.5)).toBe('poor');
    expect(formatUptime(uptimeRatio(1439, 1440))).toBe('99.93%');
    expect(formatUptime(1)).toBe('100%');
    expect(formatUptime(null)).toBe('—');
  });
});

describe('overall status', () => {
  const services = [
    { name: 'collector', up: true },
    { name: 'postgres', up: true },
  ];

  it('is the worst of CI, status page, services and source', () => {
    expect(overallStatus({ services, sourceOk: true, mainCi: 'success', statusLevel: 'operational' })).toEqual({ level: 'ok', issues: [] });
    expect(overallStatus({ services, sourceOk: true, mainCi: 'running', statusLevel: 'operational' }).level).toBe('warn');
    expect(overallStatus({ services, sourceOk: true, mainCi: 'success', statusLevel: 'partial_outage' }).level).toBe('partial');
    const bad = overallStatus({ services: [...services, { name: 'gateway', up: false }], sourceOk: false, mainCi: 'failure', statusLevel: 'no_data' });
    expect(bad.level).toBe('bad');
    expect(bad.issues).toEqual(['CI is failing on the default branch', 'gateway is down', 'manual.txt source is down']);
  });

  it('is grey without any data and ignores missing parts', () => {
    expect(overallStatus({ services: [], sourceOk: null, mainCi: 'none', statusLevel: 'no_data' }).level).toBe('none');
    expect(worstLevel(['none', 'ok'])).toBe('ok');
  });
});

describe('reviews', () => {
  it('aggregates the review decision', () => {
    expect(aggregateReviewState([])).toBe('none');
    expect(aggregateReviewState([{ author: 'bot', state: 'COMMENTED', submittedAt: '1' }])).toBe('commented');
    expect(
      aggregateReviewState([
        { author: 'a', state: 'APPROVED', submittedAt: '1' },
        { author: 'a', state: 'COMMENTED', submittedAt: '2' }, // a comment does not undo the approval
      ]),
    ).toBe('approved');
    expect(
      aggregateReviewState([
        { author: 'a', state: 'APPROVED', submittedAt: '1' },
        { author: 'b', state: 'CHANGES_REQUESTED', submittedAt: '2' },
      ]),
    ).toBe('changes_requested');
    expect(
      aggregateReviewState([
        { author: 'b', state: 'CHANGES_REQUESTED', submittedAt: '1' },
        { author: 'b', state: 'APPROVED', submittedAt: '2' },
      ]),
    ).toBe('approved');
  });

  it('counts findings as top-level inline comments by others', () => {
    const c = (author: string, inReplyToId: number | null = null) => ({ author, inReplyToId, createdAt: '2026-09-24T12:00:00Z' });
    expect(countFindings([c('bot'), c('bot'), c('me'), c('bot', 1)], 'me')).toBe(2);
  });

  it('tells what a review run posted', () => {
    const run = {
      status: 'completed',
      conclusion: 'success',
      createdAt: '2026-09-24T12:00:00Z',
      runStartedAt: '2026-09-24T12:00:05Z',
      updatedAt: '2026-09-24T12:04:00Z',
    };
    const post = (kind: 'inline' | 'issue' | 'review', at: string, author = 'review-bot[bot]') => ({ kind, author, createdAt: at });
    expect(reviewRunOutcome({ ...run, status: 'in_progress' }, [], 'me')).toEqual({ kind: 'running' });
    expect(reviewRunOutcome({ ...run, conclusion: 'failure' }, [], 'me')).toEqual({ kind: 'failed' });
    expect(reviewRunOutcome(run, [], 'me')).toEqual({ kind: 'no_comments' });
    // comments from an earlier run and by the author do not count
    expect(reviewRunOutcome(run, [post('inline', '2026-09-24T11:00:00Z'), post('issue', '2026-09-24T12:01:00Z', 'me')], 'me')).toEqual({
      kind: 'no_comments',
    });
    expect(
      reviewRunOutcome(run, [post('inline', '2026-09-24T12:03:00Z'), post('inline', '2026-09-24T12:06:00Z'), post('review', '2026-09-24T12:06:00Z')], 'me'),
    ).toEqual({ kind: 'posted', findings: 2 });
    expect(reviewRunOutcome(run, [post('issue', '2026-09-24T12:03:00Z')], 'me')).toEqual({ kind: 'posted', findings: 0 });
  });
});
