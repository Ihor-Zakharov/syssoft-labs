import { describe, expect, it } from 'vitest';
import { areaForPath, areasForPaths, compareAreas, labNumber, labNumberFromDir } from './areas.js';
import { ciStateOf, latestPerWorkflow, type RunLike } from './ci.js';
import { overallStatus, worstLevel } from './overall.js';
import { aggregateReviewState, countFindings, reviewRunOutcome } from './reviews.js';
import {
  AWS_VANTAGE,
  STATUS_SCALES,
  combinedOutcome,
  currentOutcome,
  formatUptime,
  isStatusScale,
  levelFromStates,
  statusLevel,
  uptimeRatio,
  uptimeTone,
  vantageLabel,
  type LatestCheck,
} from './status.js';
import { arrangeBranchTabs, type BranchTabInfo } from './tabs.js';
import { integrationLevel, vendorHasTrouble, type VendorStatus } from './integrations.js';
import { PAGE_SIZE, pageList, pageMath, pagerItems } from './paging.js';

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

  it('combines the vantages of one site', () => {
    // home and AWS both fresh
    expect(combinedOutcome([check('operational'), check('operational')], now)).toBe('operational');
    expect(combinedOutcome([check('operational'), check('degraded')], now)).toBe('degraded');
    expect(combinedOutcome([check('down'), check('operational')], now)).toBe('partial');
    expect(combinedOutcome([check('down'), check('down')], now)).toBe('down');
    // the PC was off: its stale check does not count, AWS alone decides
    expect(combinedOutcome([check('down', 900), check('operational')], now)).toBe('operational');
    expect(combinedOutcome([null, check('down')], now)).toBe('down');
    expect(combinedOutcome([null, check('operational', 900)], now)).toBe('no_data');
  });

  it('turns site states into the banner', () => {
    expect(levelFromStates([])).toBe('no_data');
    expect(levelFromStates(['no_data', 'no_data'])).toBe('no_data');
    expect(levelFromStates(['operational', 'operational', 'no_data'])).toBe('operational');
    expect(levelFromStates(['operational', 'degraded'])).toBe('degraded');
    // one site unreachable from one vantage only → partial outage, not major
    expect(levelFromStates(['partial', 'operational', 'operational', 'operational'])).toBe('partial_outage');
    expect(levelFromStates(['down', 'operational', 'operational', 'operational'])).toBe('partial_outage');
    expect(levelFromStates(['down', 'down', 'down', 'partial'])).toBe('major_outage');
  });

  it('names the vantages', () => {
    expect(vantageLabel('home')).toBe('Home');
    expect(vantageLabel(AWS_VANTAGE)).toBe('AWS Frankfurt');
    expect(vantageLabel('gcp-x')).toBe('gcp-x');
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

describe('integrations', () => {
  const vendor = (indicator: VendorStatus['indicator'], components: VendorStatus['components'] = [], error: string | null = null): VendorStatus => ({
    source: 'x',
    url: 'u',
    indicator,
    description: '',
    components,
    incidents: [],
    checkedAt: 't',
    error,
  });

  it('classifies the card from our connection and the vendor status', () => {
    expect(integrationLevel({ state: 'connected' }, vendor('none'))).toEqual({ level: 'connected', label: 'Connected' });
    expect(integrationLevel({ state: 'connected' }, null)).toEqual({ level: 'connected', label: 'Connected' });
    expect(integrationLevel({ state: 'connected' }, vendor('minor'))).toEqual({ level: 'degraded', label: 'Degraded' });
    expect(integrationLevel({ state: 'connected' }, vendor('none', [{ name: 'Actions', status: 'partial_outage' }])).level).toBe('degraded');
    expect(integrationLevel({ state: 'connected' }, vendor('maintenance', [{ name: 'Pages', status: 'under_maintenance' }])).level).toBe('connected');
    expect(integrationLevel({ state: 'connected' }, vendor('unknown', [], 'timeout')).level).toBe('connected');
    expect(integrationLevel({ state: 'slow' }, vendor('none'))).toEqual({ level: 'degraded', label: 'Degraded' });
    expect(integrationLevel({ state: 'auth_error' }, vendor('none'))).toEqual({ level: 'error', label: 'Auth error' });
    expect(integrationLevel({ state: 'unreachable' }, vendor('major'))).toEqual({ level: 'error', label: 'Unreachable' });
    expect(integrationLevel({ state: 'not_configured' }, vendor('critical'))).toEqual({ level: 'inactive', label: 'Not configured' });
    expect(integrationLevel({ state: 'not_deployed' }, vendor('none'))).toEqual({ level: 'inactive', label: 'Not deployed yet' });
  });

  it('only counts real trouble from the vendor', () => {
    expect(vendorHasTrouble(null)).toBe(false);
    expect(vendorHasTrouble(vendor('critical', [], 'bad json'))).toBe(false);
    expect(vendorHasTrouble(vendor('major'))).toBe(true);
    expect(vendorHasTrouble(vendor('none', [{ name: 'API Requests', status: 'degraded_performance' }]))).toBe(true);
  });
});

describe('paging', () => {
  it('uses 15 rows per page', () => {
    expect(PAGE_SIZE).toBe(15);
  });

  it('computes the visible range and clamps the page', () => {
    expect(pageMath(87, 2)).toEqual({ pages: 6, page: 2, from: 16, to: 30, offset: 15 });
    expect(pageMath(87, 6)).toEqual({ pages: 6, page: 6, from: 76, to: 87, offset: 75 });
    expect(pageMath(87, 9)).toMatchObject({ page: 6, from: 76 }); // past the end → last page
    expect(pageMath(87, 0)).toMatchObject({ page: 1, from: 1, to: 15 });
    expect(pageMath(87, Number.NaN)).toMatchObject({ page: 1 });
    expect(pageMath(0, 3)).toEqual({ pages: 1, page: 1, from: 0, to: 0, offset: 0 });
    expect(pageMath(15, 1)).toMatchObject({ pages: 1, to: 15 });
    expect(pageMath(16, 2)).toMatchObject({ pages: 2, from: 16, to: 16 });
  });

  it('shows at most 7 page buttons with gaps', () => {
    expect(pagerItems(1, 1)).toEqual([1]);
    expect(pagerItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pagerItems(2, 9)).toEqual([1, 2, 3, 4, 'gap', 9]);
    expect(pagerItems(5, 9)).toEqual([1, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pagerItems(8, 9)).toEqual([1, 'gap', 6, 7, 8, 9]);
    for (let page = 1; page <= 30; page++) expect(pagerItems(page, 30).length).toBeLessThanOrEqual(7);
  });

  it('pages an in-memory list from its anchor so new rows do not shift the pages', () => {
    const list = Array.from({ length: 40 }, (_, i) => ({ sha: `c${40 - i}`, at: new Date(Date.UTC(2026, 8, 24, 0, 40 - i)).toISOString() }));
    const key = (c: { sha: string }) => c.sha;
    const at = (c: { at: string }) => c.at;
    const first = pageList(list, { page: 1, pageSize: 15, anchor: null }, key, at);
    expect(first).toMatchObject({ total: 40, page: 1, newer: 0, anchor: { key: 'c40' } });
    const second = pageList(list, { page: 2, pageSize: 15, anchor: first.anchor }, key, at);
    expect(second.rows.map(key)).toEqual(list.slice(15, 30).map(key));

    // Two new commits on top: page 2 with the old anchor stays the same, "2 new"
    const grown = [{ sha: 'c42', at: '2026-09-24T01:00:00Z' }, { sha: 'c41', at: '2026-09-24T00:59:00Z' }, ...list];
    const again = pageList(grown, { page: 2, pageSize: 15, anchor: first.anchor }, key, at);
    expect(again.rows.map(key)).toEqual(second.rows.map(key));
    expect(again).toMatchObject({ total: 40, newer: 2 });

    // A vanished anchor (force-push) restarts from the newest; empty lists have no anchor
    expect(pageList(list, { page: 1, pageSize: 15, anchor: { at: 'x', key: 'gone' } }, key, at)).toMatchObject({ newer: 0, total: 40 });
    expect(pageList([] as typeof list, { page: 3, pageSize: 15, anchor: null }, key, at)).toEqual({ rows: [], total: 0, page: 1, pageSize: 15, anchor: null, newer: 0 });
  });
});
