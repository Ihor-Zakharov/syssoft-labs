import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, formatHash, parseHash, resolveHash, type Route } from './route';

describe('hash routing', () => {
  it('parses the top tabs and both repository tab levels', () => {
    expect(parseHash('#system')).toEqual({ top: 'system' });
    expect(parseHash('#repo/ci/overview')).toEqual({ top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 1 });
    expect(parseHash('#repo/commits/branch/lab1-task3')).toEqual({ top: 'repo', section: 'commits', scope: { kind: 'branch', name: 'lab1-task3' }, page: 1 });
    expect(parseHash('#repo/prs/branch/feature/x')).toEqual({ top: 'repo', section: 'prs', scope: { kind: 'branch', name: 'feature/x' }, page: 1 });
    expect(parseHash('#status/7d')).toEqual({ top: 'status', scale: '7d' });
  });

  it('defaults to the System tab', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#nope/overview')).toEqual(DEFAULT_ROUTE);
    expect(resolveHash('')).toEqual({ route: DEFAULT_ROUTE, redirect: '#system' });
    expect(resolveHash('#system')).toEqual({ route: DEFAULT_ROUTE, redirect: null });
  });

  it('redirects hashes from before the System/Repository split', () => {
    expect(resolveHash('#ci/overview')).toEqual({ route: { top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 1 }, redirect: '#repo/ci/overview' });
    expect(resolveHash('#commits/branch/lab1-task3').redirect).toBe('#repo/commits/branch/lab1-task3');
    expect(resolveHash('#status/90d')).toEqual({ route: { top: 'status', scale: '90d' }, redirect: null });
    expect(resolveHash('#prs').redirect).toBe('#repo/prs/overview');
  });

  it('redirects Status from under Repository to the top level', () => {
    expect(resolveHash('#repo/status/7d')).toEqual({ route: { top: 'status', scale: '7d' }, redirect: '#status/7d' });
    expect(resolveHash('#repo/status').redirect).toBe('#status/24h');
  });

  it('normalises partial and invalid repository hashes', () => {
    expect(resolveHash('#repo').redirect).toBe('#repo/ci/overview');
    expect(resolveHash('#repo/commits').redirect).toBe('#repo/commits/overview');
    expect(resolveHash('#repo/ci/branch/')).toEqual({ route: { top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 1 }, redirect: '#repo/ci/overview' });
    expect(parseHash('#repo/ci/branch/%E0%A4%A')).toEqual({ top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 1 });
    expect(resolveHash('#status/2d')).toEqual({ route: { top: 'status', scale: '24h' }, redirect: '#status/24h' });
    expect(resolveHash('#status')).toEqual({ route: { top: 'status', scale: '24h' }, redirect: '#status/24h' });
    expect(resolveHash('#repo/ci/overview').redirect).toBeNull();
  });

  it('round-trips, keeping slashes readable and escaping the rest', () => {
    const routes: Route[] = [
      DEFAULT_ROUTE,
      { top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 1 },
      { top: 'repo', section: 'prs', scope: { kind: 'branch', name: 'feature/a b#c' }, page: 1 },
      { top: 'status', scale: '90d' },
    ];
    for (const route of routes) expect(resolveHash(formatHash(route))).toEqual({ route, redirect: null });
    expect(formatHash({ top: 'repo', section: 'ci', scope: { kind: 'branch', name: 'feature/a b#c' }, page: 1 })).toBe('#repo/ci/branch/feature/a%20b%23c');
  });

  it('keeps the page of a repository list in the hash (page 1 is not written)', () => {
    expect(parseHash('#repo/ci/overview?page=2')).toEqual({ top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 2 });
    expect(parseHash('#repo/commits/branch/feature/x?page=12')).toEqual({ top: 'repo', section: 'commits', scope: { kind: 'branch', name: 'feature/x' }, page: 12 });
    expect(formatHash({ top: 'repo', section: 'prs', scope: { kind: 'overview' }, page: 3 })).toBe('#repo/prs/overview?page=3');
    expect(formatHash({ top: 'repo', section: 'prs', scope: { kind: 'overview' }, page: 1 })).toBe('#repo/prs/overview');
    for (const route of [
      { top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 7 },
      { top: 'repo', section: 'commits', scope: { kind: 'branch', name: 'feature/a b#c' }, page: 2 },
    ] as Route[])
      expect(resolveHash(formatHash(route))).toEqual({ route, redirect: null });
  });

  it('normalises invalid pages and old hashes with a page', () => {
    expect(resolveHash('#repo/ci/overview?page=1')).toMatchObject({ route: { page: 1 }, redirect: '#repo/ci/overview' });
    expect(resolveHash('#repo/ci/overview?page=0').redirect).toBe('#repo/ci/overview');
    expect(resolveHash('#repo/ci/overview?page=abc').redirect).toBe('#repo/ci/overview');
    expect(resolveHash('#repo/ci/overview?page=2.5').redirect).toBe('#repo/ci/overview');
    expect(resolveHash('#ci/overview?page=4')).toEqual({ route: { top: 'repo', section: 'ci', scope: { kind: 'overview' }, page: 4 }, redirect: '#repo/ci/overview?page=4' });
  });
});
