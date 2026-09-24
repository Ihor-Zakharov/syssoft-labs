import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, formatHash, parseHash, type Route } from './route';

describe('hash routing', () => {
  it('parses both tab levels', () => {
    expect(parseHash('#ci/overview')).toEqual({ section: 'ci', scope: { kind: 'overview' } });
    expect(parseHash('#commits/branch/lab1-task3')).toEqual({ section: 'commits', scope: { kind: 'branch', name: 'lab1-task3' } });
    expect(parseHash('#prs/branch/feature/x')).toEqual({ section: 'prs', scope: { kind: 'branch', name: 'feature/x' } });
    expect(parseHash('#status/7d')).toEqual({ section: 'status', scale: '7d' });
  });

  it('falls back to defaults for unknown or partial hashes', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#nope/overview')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#commits')).toEqual({ section: 'commits', scope: { kind: 'overview' } });
    expect(parseHash('#ci/branch/')).toEqual({ section: 'ci', scope: { kind: 'overview' } });
    expect(parseHash('#ci/branch/%E0%A4%A')).toEqual({ section: 'ci', scope: { kind: 'overview' } });
    expect(parseHash('#status/2d')).toEqual({ section: 'status', scale: '24h' });
    expect(parseHash('#status')).toEqual({ section: 'status', scale: '24h' });
  });

  it('round-trips, keeping slashes readable and escaping the rest', () => {
    const routes: Route[] = [
      DEFAULT_ROUTE,
      { section: 'prs', scope: { kind: 'branch', name: 'feature/a b#c' } },
      { section: 'status', scale: '90d' },
    ];
    for (const route of routes) expect(parseHash(formatHash(route))).toEqual(route);
    expect(formatHash({ section: 'ci', scope: { kind: 'branch', name: 'feature/a b#c' } })).toBe('#ci/branch/feature/a%20b%23c');
  });
});
