import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, formatHash, parseHash, resolveHash, type Route } from './route';

describe('hash routing', () => {
  it('parses the top tabs and both repository tab levels', () => {
    expect(parseHash('#system')).toEqual({ top: 'system' });
    expect(parseHash('#repo/ci/overview')).toEqual({ top: 'repo', section: 'ci', scope: { kind: 'overview' } });
    expect(parseHash('#repo/commits/branch/lab1-task3')).toEqual({ top: 'repo', section: 'commits', scope: { kind: 'branch', name: 'lab1-task3' } });
    expect(parseHash('#repo/prs/branch/feature/x')).toEqual({ top: 'repo', section: 'prs', scope: { kind: 'branch', name: 'feature/x' } });
    expect(parseHash('#repo/status/7d')).toEqual({ top: 'repo', section: 'status', scale: '7d' });
  });

  it('defaults to the System tab', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#nope/overview')).toEqual(DEFAULT_ROUTE);
    expect(resolveHash('')).toEqual({ route: DEFAULT_ROUTE, redirect: '#system' });
    expect(resolveHash('#system')).toEqual({ route: DEFAULT_ROUTE, redirect: null });
  });

  it('redirects hashes from before the System/Repository split', () => {
    expect(resolveHash('#ci/overview')).toEqual({ route: { top: 'repo', section: 'ci', scope: { kind: 'overview' } }, redirect: '#repo/ci/overview' });
    expect(resolveHash('#commits/branch/lab1-task3').redirect).toBe('#repo/commits/branch/lab1-task3');
    expect(resolveHash('#status/90d')).toEqual({ route: { top: 'repo', section: 'status', scale: '90d' }, redirect: '#repo/status/90d' });
    expect(resolveHash('#prs').redirect).toBe('#repo/prs/overview');
  });

  it('normalises partial and invalid repository hashes', () => {
    expect(resolveHash('#repo').redirect).toBe('#repo/ci/overview');
    expect(resolveHash('#repo/commits').redirect).toBe('#repo/commits/overview');
    expect(resolveHash('#repo/ci/branch/')).toEqual({ route: { top: 'repo', section: 'ci', scope: { kind: 'overview' } }, redirect: '#repo/ci/overview' });
    expect(parseHash('#repo/ci/branch/%E0%A4%A')).toEqual({ top: 'repo', section: 'ci', scope: { kind: 'overview' } });
    expect(resolveHash('#repo/status/2d')).toEqual({ route: { top: 'repo', section: 'status', scale: '24h' }, redirect: '#repo/status/24h' });
    expect(resolveHash('#repo/ci/overview').redirect).toBeNull();
  });

  it('round-trips, keeping slashes readable and escaping the rest', () => {
    const routes: Route[] = [
      DEFAULT_ROUTE,
      { top: 'repo', section: 'ci', scope: { kind: 'overview' } },
      { top: 'repo', section: 'prs', scope: { kind: 'branch', name: 'feature/a b#c' } },
      { top: 'repo', section: 'status', scale: '90d' },
    ];
    for (const route of routes) expect(resolveHash(formatHash(route))).toEqual({ route, redirect: null });
    expect(formatHash({ top: 'repo', section: 'ci', scope: { kind: 'branch', name: 'feature/a b#c' } })).toBe('#repo/ci/branch/feature/a%20b%23c');
  });
});
