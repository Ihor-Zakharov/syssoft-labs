import { describe, expect, it } from 'vitest';
import { mapCommit, mapPull, mapRun, pickBranches, type RawRun } from './github-map.js';

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
