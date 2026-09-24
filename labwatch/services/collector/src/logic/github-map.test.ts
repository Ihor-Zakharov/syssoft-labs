import { describe, expect, it } from 'vitest';
import { labsFromTree, mapComment, mapCommit, mapCommitFiles, mapCompare, mapJob, mapPull, mapReview, mapRun, pickBranches, type RawRun } from './github-map.js';

describe('github mapping', () => {
  it('maps a workflow run', () => {
    const raw: RawRun = {
      id: 35991770211,
      name: 'CI',
      run_number: 4,
      run_attempt: 1,
      head_branch: 'task1',
      head_sha: '8e82e62',
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      display_title: 'Lab1 Task1',
      actor: { login: 'Ihor-Zakharov' },
      html_url: 'https://github.com/Ihor-Zakharov/syssoft-labs/actions/runs/35991770211',
      created_at: '2026-09-24T11:13:29Z',
      updated_at: '2026-09-24T11:14:42Z',
      run_started_at: '2026-09-24T11:13:29Z',
    };
    expect(mapRun('Ihor-Zakharov/syssoft-labs', raw)).toMatchObject({
      id: 35991770211,
      workflowName: 'CI',
      branch: 'task1',
      title: 'Lab1 Task1',
      actor: 'Ihor-Zakharov',
    });
  });

  it('maps commits and pull requests with missing optional fields', () => {
    const commit = mapCommit('o/r', {
      sha: 'abc',
      html_url: 'u',
      commit: { message: 'm', author: null, committer: { date: '2026-09-24T11:00:00Z' } },
      author: null,
    });
    expect(commit).toMatchObject({ authorName: null, authorLogin: null, verified: false, committedAt: '2026-09-24T11:00:00Z' });

    const pull = mapPull('o/r', {
      number: 1,
      title: 't',
      state: 'closed',
      merged_at: '2026-09-24T12:00:00Z',
      user: { login: 'me' },
      head: { ref: 'task1' },
      base: { ref: 'main' },
      created_at: 'a',
      updated_at: 'b',
      html_url: 'u',
    });
    expect(pull).toMatchObject({ merged: true, draft: false, headRef: 'task1' });
  });

  it('follows the default branch first, then others by name, up to the limit', () => {
    const b = (name: string) => ({ repo: 'o/r', name, headSha: name, protected: false });
    const picked = pickBranches([b('zeta'), b('alpha'), b('main'), b('beta')], 'main', 3);
    expect(picked.map((x) => x.name)).toEqual(['main', 'alpha', 'beta']);
  });
});

describe('github mapping (fixtures)', () => {
  it('maps jobs with steps', () => {
    const job = mapJob({
      id: 1,
      run_id: 2,
      name: 'build-test',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-09-24T12:00:00Z',
      completed_at: '2026-09-24T12:01:00Z',
      html_url: 'https://github.com/o/r/actions/runs/2/job/1',
      steps: [
        { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', started_at: 'a', completed_at: 'b' },
        { number: 2, name: 'Test', status: 'completed', conclusion: 'failure' },
      ],
    });
    expect(job.steps).toEqual([
      { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', startedAt: 'a', completedAt: 'b' },
      { number: 2, name: 'Test', status: 'completed', conclusion: 'failure', startedAt: null, completedAt: null },
    ]);
    const noSteps = { id: 3, run_id: 2, name: 'queued', status: 'queued', conclusion: null, started_at: null, completed_at: null, html_url: null };
    expect(mapJob(noSteps).steps).toEqual([]);
  });

  it('maps compare results to ahead/behind and areas', () => {
    const compare = mapCompare(
      'main',
      'aaa',
      'lab1-task3',
      'bbb',
      {
        status: 'diverged',
        ahead_by: 2,
        behind_by: 1,
        commits: [{ sha: 'c1' }, { sha: 'c2' }],
        files: [{ filename: 'Lab1/Task3/Form1.cs' }, { filename: 'Lab1/README.md' }, { filename: '.github/workflows/ci.yml' }],
      },
      new Date('2026-09-24T12:00:00Z'),
    );
    expect(compare).toMatchObject({ aheadBy: 2, behindBy: 1, aheadShas: ['c1', 'c2'], areas: ['Lab 1', 'CI'], fileCount: 3 });
  });

  it('maps commit files, trees, reviews and comments', () => {
    expect(mapCommitFiles({ sha: 'x', files: [{ filename: 'a', status: 'added' }] })).toEqual({
      files: [{ path: 'a', status: 'added' }],
      truncated: false,
    });
    expect(mapCommitFiles({ sha: 'x' })).toEqual({ files: [], truncated: false });
    expect(
      labsFromTree({
        tree: [
          { path: 'Lab2', type: 'tree' },
          { path: 'Lab1', type: 'tree' },
          { path: 'Lab3.md', type: 'blob' },
          { path: 'labwatch', type: 'tree' },
          { path: 'Lab10', type: 'tree' },
        ],
      }),
    ).toEqual([1, 2, 10]);
    expect(mapReview({ id: 5, user: { login: 'review-bot[bot]' }, state: 'COMMENTED', body: null })).toEqual({
      id: 5,
      author: 'review-bot[bot]',
      state: 'COMMENTED',
      body: '',
      submittedAt: null,
      htmlUrl: null,
    });
    const inline = mapComment(
      {
        id: 9,
        user: { login: 'review-bot[bot]' },
        body: '**Bug**',
        created_at: 'c',
        updated_at: 'u',
        html_url: 'h',
        path: 'Lab1/x.cs',
        line: null,
        original_line: 27,
      },
      'inline',
    );
    expect(inline).toMatchObject({ kind: 'inline', path: 'Lab1/x.cs', line: 27, inReplyToId: null });
    expect(mapPull('o/r', { ...basePull, head: { ref: 't', sha: 'abc' } }).headSha).toBe('abc');
  });
});

const basePull = {
  number: 1,
  title: 't',
  state: 'open',
  merged_at: null,
  user: null,
  head: { ref: 't' },
  base: { ref: 'main' },
  created_at: 'a',
  updated_at: 'b',
  html_url: 'u',
};
