import type { BranchState, CiRun, CommitsStatus, PullRequest } from '@labwatch/shared';
import { describe, expect, it } from 'vitest';
import { aheadOfMain, branchSummaries, checksFor, commitAreas, inMain, prForBranch } from './views.js';

const commit = (sha: string, at: string) => ({
  sha,
  repo: 'o/r',
  message: sha,
  authorName: null,
  authorLogin: 'me',
  committedAt: at,
  htmlUrl: 'u',
  verified: true,
});

const branch = (name: string, headSha: string, o: Partial<BranchState> = {}): BranchState => ({
  repo: 'o/r',
  name,
  headSha,
  protected: false,
  commitsSha: headSha,
  commits: [commit(headSha, '2026-09-20T10:00:00Z')],
  compare: null,
  ...o,
});

const compare = (head: string, headSha: string, aheadShas: string[], behindBy = 0) => ({
  base: 'main',
  head,
  baseSha: 'm1',
  headSha,
  status: aheadShas.length ? 'ahead' : 'identical',
  aheadBy: aheadShas.length,
  behindBy,
  aheadShas,
  areas: ['Lab 1'],
  fileCount: 1,
  fetchedAt: 'x',
});

const run = (headSha: string, o: Partial<CiRun> = {}): CiRun => ({
  id: Math.floor(Math.random() * 1e9),
  repo: 'o/r',
  workflowName: 'CI',
  runNumber: 1,
  runAttempt: 1,
  branch: 'x',
  headSha,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  title: 't',
  actor: 'me',
  htmlUrl: 'u',
  createdAt: '2026-09-21T10:00:00Z',
  updatedAt: '2026-09-21T10:05:00Z',
  runStartedAt: null,
  ...o,
});

const pull = (number: number, headRef: string, o: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'o/r',
  number,
  title: 't',
  state: 'open',
  draft: false,
  merged: false,
  author: 'me',
  headRef,
  headSha: null,
  baseRef: 'main',
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-22T00:00:00Z',
  htmlUrl: 'u',
  ...o,
});

describe('branch summaries', () => {
  const status: CommitsStatus = {
    repo: 'o/r',
    updatedAt: 'x',
    defaultBranch: 'main',
    labs: [1],
    labsSha: 'm1',
    branches: [
      branch('main', 'm1'),
      branch('task1', 't1', { compare: compare('task1', 't1', ['t1']) }),
      branch('old', 'o1', { compare: compare('old', 'o1', [], 3) }),
      branch('done', 'd1', { compare: compare('done', 'd1', ['d1']) }),
      branch('moved', 'n2', { compare: compare('moved', 'n1', ['n1']) }), // compare is for an older head
    ],
  };

  it('computes CI dot, activity, merged state, PR and findings', () => {
    const summaries = branchSummaries({
      status,
      headRuns: [run('t1', { conclusion: 'failure' }), run('m1'), run('n2', { status: 'in_progress', conclusion: null })],
      lastRunAt: new Map([['task1', '2026-09-23T12:00:00Z']]),
      pulls: [pull(1, 'task1'), pull(2, 'done', { state: 'closed', merged: true, updatedAt: '2026-09-24T00:00:00Z' })],
      findingsByPr: new Map([[1, 5]]),
    });
    const by = new Map(summaries.map((s) => [s.name, s]));
    expect(by.get('main')).toMatchObject({ isDefault: true, ciState: 'success', merged: false, aheadBy: null });
    expect(by.get('task1')).toMatchObject({
      ciState: 'failure',
      lastActivityAt: '2026-09-23T12:00:00Z',
      aheadBy: 1,
      pr: { number: 1 },
      findings: 5,
      merged: false,
    });
    expect(by.get('old')).toMatchObject({ merged: true, aheadBy: 0, behindBy: 3, ciState: 'none' });
    expect(by.get('done')).toMatchObject({ merged: true, lastActivityAt: '2026-09-24T00:00:00Z' });
    expect(by.get('moved')).toMatchObject({ ciState: 'running', aheadBy: null });
  });

  it('marks commits that are not in main', () => {
    const ahead = aheadOfMain(status);
    expect([...ahead].sort()).toEqual(['d1', 't1']); // 'moved' has a stale compare
    expect(inMain('t1', ['task1'], 'main', ahead)).toBe(false);
    expect(inMain('m1', ['main', 'task1'], 'main', ahead)).toBe(true);
    expect(inMain('zz', ['moved'], 'main', ahead)).toBeNull();
  });
});

describe('view helpers', () => {
  it('prefers the open PR of a branch', () => {
    const pulls = [pull(1, 'b', { state: 'closed', updatedAt: '2026-09-24T00:00:00Z' }), pull(2, 'b', { updatedAt: '2026-09-20T00:00:00Z' })];
    expect(prForBranch(pulls, 'b')?.number).toBe(2);
    expect(prForBranch(pulls, 'c')).toBeNull();
  });

  it('maps file paths to areas, null while unknown', () => {
    expect(commitAreas(undefined)).toBeNull();
    expect(commitAreas([])).toEqual([]);
    expect(commitAreas(['Lab1/a', 'README.md'])).toEqual(['Lab 1', 'Repo']);
  });

  it('lists the latest run per workflow as PR checks', () => {
    const checks = checksFor([
      run('h', { workflowName: 'labwatch', runNumber: 1 }),
      run('h', { workflowName: 'CI', runNumber: 3, conclusion: 'failure' }),
      run('h', { workflowName: 'CI', runNumber: 3, runAttempt: 2, conclusion: 'success' }),
    ]);
    expect(checks.map((c) => [c.workflowName, c.conclusion])).toEqual([
      ['CI', 'success'],
      ['labwatch', 'success'],
    ]);
  });
});
