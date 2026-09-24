import { DEFAULT_STATUS_SCALE, isStatusScale, type StatusScale } from '@labwatch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export const TOP_TABS = [
  { id: 'system', label: 'System' },
  { id: 'repo', label: 'Repository' },
] as const;

export const SECTIONS = [
  { id: 'ci', label: 'CI runs' },
  { id: 'commits', label: 'Commits' },
  { id: 'prs', label: 'Pull requests' },
  { id: 'status', label: 'Status' },
] as const;

export type Section = 'ci' | 'commits' | 'prs';
export type Scope = { kind: 'overview' } | { kind: 'branch'; name: string };
export type RepoRoute = { section: Section; scope: Scope } | { section: 'status'; scale: StatusScale };
export type Route = { top: 'system' } | ({ top: 'repo' } & RepoRoute);

export const DEFAULT_REPO_ROUTE: RepoRoute = { section: 'ci', scope: { kind: 'overview' } };
export const DEFAULT_ROUTE: Route = { top: 'system' };

const SECTION_IDS = new Set<string>(['ci', 'commits', 'prs']);
const LEGACY_SECTIONS = new Set<string>(['ci', 'commits', 'prs', 'status']);

/** Branch names may contain "/": keep them readable in the hash, encode everything else. */
function encodeBranch(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

/** `ci/overview`, `commits/branch/lab1-task3`, `status/24h` (the part after `#repo/`). */
function parseRepo(path: string): RepoRoute {
  const [section = '', ...rest] = path.split('/');
  if (section === 'status') {
    const scale = rest[0] ?? '';
    return { section: 'status', scale: isStatusScale(scale) ? scale : DEFAULT_STATUS_SCALE };
  }
  if (!SECTION_IDS.has(section)) return DEFAULT_REPO_ROUTE;
  if (rest[0] === 'branch' && rest.length > 1) {
    try {
      const name = rest.slice(1).map(decodeURIComponent).join('/');
      if (name) return { section: section as Section, scope: { kind: 'branch', name } };
    } catch {
      // malformed escape: fall through to the overview
    }
  }
  return { section: section as Section, scope: { kind: 'overview' } };
}

function formatRepo(route: RepoRoute): string {
  if (route.section === 'status') return `status/${route.scale}`;
  return route.scope.kind === 'overview' ? `${route.section}/overview` : `${route.section}/branch/${encodeBranch(route.scope.name)}`;
}

export function formatHash(route: Route): string {
  return route.top === 'system' ? '#system' : `#repo/${formatRepo(route)}`;
}

/**
 * `#system`, `#repo/ci/overview`, `#repo/commits/branch/lab1-task3`, `#repo/status/24h`.
 * Hashes from before the System/Repository split (`#ci/overview`, `#status/24h`, …) still work:
 * they resolve to the repository tab and `redirect` gives the canonical hash to replace them with.
 */
export function resolveHash(hash: string): { route: Route; redirect: string | null } {
  const path = hash.replace(/^#\/?/, '');
  const [first = ''] = path.split('/');
  let route: Route;
  if (first === 'repo') route = { top: 'repo', ...parseRepo(path.slice('repo'.length + 1)) };
  else if (LEGACY_SECTIONS.has(first)) route = { top: 'repo', ...parseRepo(path) };
  else route = DEFAULT_ROUTE;
  const canonical = formatHash(route);
  return { route, redirect: canonical === `#${path}` ? null : canonical };
}

export function parseHash(hash: string): Route {
  return resolveHash(hash).route;
}

/**
 * The route lives in the URL hash: reload keeps it, back/forward walk through it. Switching the
 * top tab keeps the repository position; switching the section keeps the branch and the scale.
 */
export function useRoute(): {
  route: Route;
  navigate: (route: Route) => void;
  openTop: (top: Route['top']) => void;
  openSection: (section: RepoRoute['section']) => void;
} {
  const [route, setRoute] = useState<Route>(() => resolveHash(window.location.hash).route);
  const lastRepo = useRef<RepoRoute>(route.top === 'repo' ? route : DEFAULT_REPO_ROUTE);
  const lastScope = useRef<Scope>(route.top === 'repo' && route.section !== 'status' ? route.scope : { kind: 'overview' });
  const lastScale = useRef<StatusScale>(route.top === 'repo' && route.section === 'status' ? route.scale : DEFAULT_STATUS_SCALE);

  useEffect(() => {
    const sync = () => {
      const { route: next, redirect } = resolveHash(window.location.hash);
      // Old or partial hashes are replaced in place, without an extra history entry
      if (redirect) window.history.replaceState(null, '', redirect);
      setRoute(next);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (route.top !== 'repo') return;
    lastRepo.current = route;
    if (route.section === 'status') lastScale.current = route.scale;
    else lastScope.current = route.scope;
  }, [route]);

  const navigate = useCallback((next: Route) => {
    const hash = formatHash(next);
    if (window.location.hash !== hash) window.location.hash = hash; // pushes a history entry
    setRoute(next);
  }, []);

  const openTop = useCallback((top: Route['top']) => navigate(top === 'system' ? { top } : { top, ...lastRepo.current }), [navigate]);

  const openSection = useCallback(
    (section: RepoRoute['section']) =>
      navigate(section === 'status' ? { top: 'repo', section, scale: lastScale.current } : { top: 'repo', section, scope: lastScope.current }),
    [navigate],
  );

  return { route, navigate, openTop, openSection };
}
