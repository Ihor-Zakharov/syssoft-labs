import type { CiRun } from '@labwatch/shared';
import { describe, expect, it } from 'vitest';
import { ciKey, diffCi, latestMeaningful } from './ci-diff.js';

const now = new Date('2026-09-24T12:00:00Z');

function run(overrides: Partial<CiRun>): CiRun {
  return {
    id: 1,
    repo: 'o/r',
    workflowName: 'CI',
    runNumber: 1,
    runAttempt: 1,
    branch: 'main',
    headSha: 'abc',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    title: 't',
    actor: 'me',
    htmlUrl: 'https://github.com/o/r/actions/runs/1',
    createdAt: '2026-09-24T10:00:00Z',
    updatedAt: '2026-09-24T10:05:00Z',
    runStartedAt: '2026-09-24T10:00:00Z',
    ...overrides,
  };
}

describe('diffCi', () => {
  it('seeds silently when there is no previous state', () => {
    const { next, events } = diffCi(null, [run({ conclusion: 'failure' })], now);
    expect(events).toEqual([]);
    expect(next).toEqual({ 'CI@main': 'failure' });
  });

  it('reports green → red', () => {
    const { events } = diffCi({ 'CI@main': 'success' }, [run({ id: 2, runNumber: 2, conclusion: 'failure' })], now);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'ci.failed', severity: 'error', data: { previous: 'success', runNumber: 2 } });
  });

  it('reports red → green', () => {
    const { events } = diffCi({ 'CI@main': 'failure' }, [run({ conclusion: 'success' })], now);
    expect(events.map((e) => e.kind)).toEqual(['ci.recovered']);
  });

  it('stays quiet while nothing changes', () => {
    expect(diffCi({ 'CI@main': 'success' }, [run({})], now).events).toEqual([]);
    expect(diffCi({ 'CI@main': 'failure' }, [run({ conclusion: 'timed_out' })], now).events).toEqual([]);
  });

  it('reports a failure on a branch it has never seen', () => {
    const { events } = diffCi({ 'CI@main': 'success' }, [run({ branch: 'feature', conclusion: 'failure' })], now);
    expect(events.map((e) => e.kind)).toEqual(['ci.failed']);
  });

  it('ignores running, cancelled and skipped runs', () => {
    const runs = [
      run({ runNumber: 3, status: 'in_progress', conclusion: null }),
      run({ runNumber: 2, conclusion: 'cancelled' }),
      run({ runNumber: 1, conclusion: 'success' }),
    ];
    expect(diffCi({ 'CI@main': 'success' }, runs, now).events).toEqual([]);
    expect(latestMeaningful(runs).get('CI@main')?.runNumber).toBe(1);
  });

  it('uses the newest attempt of a re-run', () => {
    const runs = [run({ runAttempt: 1, conclusion: 'failure' }), run({ runAttempt: 2, conclusion: 'success' })];
    const { next, events } = diffCi({ 'CI@main': 'failure' }, runs, now);
    expect(next['CI@main']).toBe('success');
    expect(events.map((e) => e.kind)).toEqual(['ci.recovered']);
  });

  it('keys by workflow and branch', () => {
    expect(ciKey({ workflowName: 'Code review', branch: null })).toBe('Code review@-');
  });
});
