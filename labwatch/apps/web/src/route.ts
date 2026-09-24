import { DEFAULT_STATUS_SCALE, isStatusScale, type StatusScale } from '@labwatch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export const SECTIONS = [
  { id: 'ci', label: 'CI runs' },
  { id: 'commits', label: 'Commits' },
  { id: 'prs', label: 'Pull requests' },
  { id: 'status', label: 'Status' },
] as const;

export type Section = 'ci' | 'commits' | 'prs';
export type Scope = { kind: 'overview' } | { kind: 'branch'; name: string };
export type Route = { section: Section; scope: Scope } | { section: 'status'; scale: StatusScale };

export const DEFAULT_ROUTE: Route = { section: 'ci', scope: { kind: 'overview' } };

const SECTION_IDS = new Set<string>(['ci', 'commits', 'prs']);

/** Branch names may contain "/": keep them readable in the hash, encode everything else. */
function encodeBranch(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

/**
 * `#ci/overview`, `#commits/branch/lab1-task3`, `#prs/branch/feature/x`, `#status/24h`.
 * Anything unknown falls back to a sensible default instead of an error page.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [section = '', ...rest] = path.split('/');
  if (section === 'status') {
    const scale = rest[0] ?? '';
    return { section: 'status', scale: isStatusScale(scale) ? scale : DEFAULT_STATUS_SCALE };
  }
  if (!SECTION_IDS.has(section)) return DEFAULT_ROUTE;
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

export function formatHash(route: Route): string {
  if (route.section === 'status') return `#status/${route.scale}`;
  return route.scope.kind === 'overview' ? `#${route.section}/overview` : `#${route.section}/branch/${encodeBranch(route.scope.name)}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatHash(a) === formatHash(b);
}

/**
 * The route lives in the URL hash: reload keeps it, back/forward walk through it. Switching the
 * primary tab keeps the secondary one (branch scope, status scale).
 */
export function useRoute(): {
  route: Route;
  navigate: (route: Route) => void;
  openSection: (section: Route['section']) => void;
} {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const lastScope = useRef<Scope>(route.section === 'status' ? { kind: 'overview' } : route.scope);
  const lastScale = useRef<StatusScale>(route.section === 'status' ? route.scale : DEFAULT_STATUS_SCALE);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', formatHash(route));
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (route.section === 'status') lastScale.current = route.scale;
    else lastScope.current = route.scope;
  }, [route]);

  const navigate = useCallback((next: Route) => {
    const hash = formatHash(next);
    if (window.location.hash !== hash) window.location.hash = hash; // pushes a history entry
    setRoute(next);
  }, []);

  const openSection = useCallback(
    (section: Route['section']) =>
      navigate(section === 'status' ? { section, scale: lastScale.current } : { section, scope: lastScope.current }),
    [navigate],
  );

  return { route, navigate, openSection };
}
