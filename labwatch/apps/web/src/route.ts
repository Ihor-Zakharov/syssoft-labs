import { DEFAULT_STATUS_SCALE, isStatusScale, type StatusScale } from '@labwatch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export const TOP_TABS = [
  { id: 'system', label: 'System' },
  { id: 'repo', label: 'Repository' },
  { id: 'status', label: 'Status' },
] as const;

export const SECTIONS = [
  { id: 'ci', label: 'CI runs' },
  { id: 'commits', label: 'Commits' },
  { id: 'prs', label: 'Pull requests' },
] as const;

export type Section = 'ci' | 'commits' | 'prs';
export type Scope = { kind: 'overview' } | { kind: 'branch'; name: string };
export type RepoRoute = { section: Section; scope: Scope };
export type Route = { top: 'system' } | ({ top: 'repo' } & RepoRoute) | { top: 'status'; scale: StatusScale };

export const DEFAULT_REPO_ROUTE: RepoRoute = { section: 'ci', scope: { kind: 'overview' } };
export const DEFAULT_ROUTE: Route = { top: 'system' };

const SECTION_IDS = new Set<string>(['ci', 'commits', 'prs']);

/** Branch names may contain "/": keep them readable in the hash, encode everything else. */
function encodeBranch(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

function parseScale(value: string | undefined): StatusScale {
  return value && isStatusScale(value) ? value : DEFAULT_STATUS_SCALE;
}

/** `ci/overview`, `commits/branch/lab1-task3` (the part after `#repo/`). */
function parseRepo(path: string): RepoRoute {
  const [section = '', ...rest] = path.split('/');
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
  return route.scope.kind === 'overview' ? `${route.section}/overview` : `${route.section}/branch/${encodeBranch(route.scope.name)}`;
}

export function formatHash(route: Route): string {
  if (route.top === 'system') return '#system';
  if (route.top === 'status') return `#status/${route.scale}`;
  return `#repo/${formatRepo(route)}`;
}

/**
 * `#system`, `#repo/ci/overview`, `#repo/commits/branch/lab1-task3`, `#status/24h`.
 * Older hashes still work and `redirect` gives the canonical one to replace them with:
 * `#ci/overview` (before the System/Repository split) → `#repo/ci/overview`,
 * `#repo/status/24h` (when Status lived under Repository) → `#status/24h`.
 */
export function resolveHash(hash: string): { route: Route; redirect: string | null } {
  const path = hash.replace(/^#\/?/, '');
  const [first = '', second = '', third] = path.split('/');
  let route: Route;
  if (first === 'status') route = { top: 'status', scale: parseScale(second) };
  else if (first === 'repo' && second === 'status') route = { top: 'status', scale: parseScale(third) };
  else if (first === 'repo') route = { top: 'repo', ...parseRepo(path.slice('repo'.length + 1)) };
  else if (SECTION_IDS.has(first)) route = { top: 'repo', ...parseRepo(path) };
  else route = DEFAULT_ROUTE;
  const canonical = formatHash(route);
  return { route, redirect: canonical === `#${path}` ? null : canonical };
}

export function parseHash(hash: string): Route {
  return resolveHash(hash).route;
}

/**
 * The route lives in the URL hash: reload keeps it, back/forward walk through it. Switching the
 * top tab keeps the repository position and the status scale; switching the section keeps the branch.
 */
export function useRoute(): {
  route: Route;
  navigate: (route: Route) => void;
  openTop: (top: Route['top']) => void;
  openSection: (section: Section) => void;
} {
  const [route, setRoute] = useState<Route>(() => resolveHash(window.location.hash).route);
  const lastRepo = useRef<RepoRoute>(route.top === 'repo' ? route : DEFAULT_REPO_ROUTE);
  const lastScale = useRef<StatusScale>(route.top === 'status' ? route.scale : DEFAULT_STATUS_SCALE);

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
    if (route.top === 'repo') lastRepo.current = { section: route.section, scope: route.scope };
    if (route.top === 'status') lastScale.current = route.scale;
  }, [route]);

  const navigate = useCallback((next: Route) => {
    const hash = formatHash(next);
    if (window.location.hash !== hash) window.location.hash = hash; // pushes a history entry
    setRoute(next);
  }, []);

  const openTop = useCallback(
    (top: Route['top']) =>
      navigate(top === 'system' ? { top } : top === 'status' ? { top, scale: lastScale.current } : { top, ...lastRepo.current }),
    [navigate],
  );

  const openSection = useCallback(
    (section: Section) => navigate({ top: 'repo', section, scope: lastRepo.current.scope }),
    [navigate],
  );

  return { route, navigate, openTop, openSection };
}
