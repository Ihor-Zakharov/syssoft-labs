import { arrangeBranchTabs, PAGE_SIZE, type BranchSummary, type Overview } from '@labwatch/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CI_STATE_LABEL, Dot, ciTone, levelTone, statusTone } from './components/Badge';
import { EventFeed } from './components/EventFeed';
import { HealthTiles } from './components/HealthTiles';
import { Integrations } from './components/Integrations';
import { SourceCard } from './components/SourceCard';
import { usePageAnchor, useRememberAnchor } from './components/Pager';
import { OverflowMenu, TabList, type TabItem } from './components/Tabs';
import { formatDate, useNow } from './format';
import { useLiveUpdates } from './live';
import { SECTIONS, TOP_TABS, useRoute, type RepoRoute, type Route, type Section } from './route';
import { CiSection } from './sections/CiSection';
import { CommitsSection } from './sections/CommitsSection';
import { PullsSection } from './sections/PullsSection';
import { StatusSection } from './sections/StatusSection';
import { useTRPC } from './trpc';

const PANEL_ID = 'panel';
const REPO_PANEL_ID = 'repo-panel';

/** A tab caption that keeps its width when it turns bold (see .tab-label in styles.css). */
function TabLabel({ text }: { text: string }) {
  return (
    <span className="tab-label" data-text={text}>
      {text}
    </span>
  );
}

function branchTab(b: BranchSummary): TabItem {
  const extra = [CI_STATE_LABEL[b.ciState], b.merged ? 'merged' : null, b.findings ? `${b.findings} review findings` : null].filter(Boolean).join(', ');
  return {
    id: `branch:${b.name}`,
    title: `${b.name} — ${extra}`,
    label: (
      <>
        <Dot tone={ciTone(b.ciState)} />
        <TabLabel text={b.name} />
        {b.findings > 0 && <span className="tab-count">{b.findings}</span>}
      </>
    ),
  };
}

/** Services, the lab source, events and external integrations. */
function SystemView({ overview, now }: { overview: Overview | undefined; now: number }) {
  const trpc = useTRPC();
  const probes = useQuery(trpc.sourceProbes.queryOptions({ limit: 60 }));
  // The event feed pages locally (it is not part of the URL): 15 per page, anchored like the other lists
  const [eventsPage, setEventsPage] = useState(1);
  const { anchor, remember } = usePageAnchor(eventsPage, 'events');
  const events = useQuery({ ...trpc.events.queryOptions({ page: eventsPage, pageSize: PAGE_SIZE, anchor }), placeholderData: keepPreviousData });
  useRememberAnchor(events.isPlaceholderData ? undefined : events.data, eventsPage, remember, setEventsPage);
  const integrations = useQuery({ ...trpc.integrations.queryOptions(), refetchInterval: 60_000 });
  return (
    <div className="system">
      <section className="top-section" aria-label="Services">
        {overview ? <HealthTiles services={overview.services} now={now} /> : <div className="tiles" />}
        <div className="grid">
          <SourceCard source={overview?.source ?? null} probes={probes.data ?? []} now={now} />
          <EventFeed events={events.data} onPage={setEventsPage} now={now} />
        </div>
      </section>
      <Integrations statuses={integrations.data} now={now} />
    </div>
  );
}

/** CI runs | Commits | Pull requests, with the branch tabs. */
function RepositoryView({
  route,
  overview,
  navigate,
  openSection,
  now,
}: {
  route: RepoRoute;
  overview: Overview | undefined;
  navigate: (route: Route) => void;
  openSection: (section: Section) => void;
  now: number;
}) {
  const trpc = useTRPC();
  const branches = useQuery(trpc.branches.queryOptions());
  const tabs = useMemo(() => arrangeBranchTabs(branches.data?.branches ?? [], new Date(now)), [branches.data, Math.floor(now / 60_000)]);

  const primary: TabItem[] = SECTIONS.map((s) => ({ id: s.id, label: <TabLabel text={s.label} /> }));

  const section = route.section;
  const scope = route.scope;
  const selectedBranch = scope.kind === 'branch' ? scope.name : null;
  const secondaryId = scope.kind === 'overview' ? 'overview' : `branch:${scope.name}`;

  const secondary: TabItem[] = [
    {
      id: 'overview',
      title: overview ? `Overview — ${overview.overall.issues.join('; ') || 'all good'}` : 'Overview',
      label: (
        <>
          <Dot tone={overview ? levelTone(overview.overall.level) : 'muted'} /> <TabLabel text="Overview" />
        </>
      ),
    },
    ...tabs.visible.map(branchTab),
  ];
  // A branch opened from the overflow menu (or a link) gets a temporary tab so the selection stays visible
  const extra = selectedBranch && !secondary.some((t) => t.id === `branch:${selectedBranch}`) ? selectedBranch : null;
  if (extra) {
    const known = tabs.overflow.find((b) => b.name === extra);
    secondary.push(known ? branchTab(known) : { id: `branch:${extra}`, label: <TabLabel text={extra} />, title: `${extra} (not a current branch)` });
  }

  const openPage = (page: number) => navigate({ top: 'repo', section, scope, page });

  const selectSecondary = (id: string) => {
    navigate(
      id === 'overview'
        ? { top: 'repo', section, scope: { kind: 'overview' }, page: 1 }
        : { top: 'repo', section, scope: { kind: 'branch', name: id.slice('branch:'.length) }, page: 1 },
    );
  };

  const branchKnown = !selectedBranch || branches.isPending || (branches.data?.branches ?? []).some((b) => b.name === selectedBranch);

  return (
    <>
      <TabList items={primary} selectedId={section} onSelect={(id) => openSection(id as Section)} label="Sections" variant="primary" panelId={REPO_PANEL_ID} />
      <TabList
        items={secondary}
        selectedId={secondaryId}
        onSelect={selectSecondary}
        label="Branches"
        variant="secondary"
        panelId={REPO_PANEL_ID}
        after={<OverflowMenu label="Merged and idle branches" items={tabs.overflow.filter((b) => b.name !== extra).map(branchTab)} onSelect={selectSecondary} />}
      />
      <div id={REPO_PANEL_ID} role="tabpanel" aria-labelledby={`tab-primary-${section}`} className="panel">
        {!branchKnown && <p className="notice">Branch “{selectedBranch}” is not among the current branches; showing what was recorded for it.</p>}
        {section === 'ci' && <CiSection key={selectedBranch ?? ''} branch={selectedBranch} page={route.page} onPage={openPage} now={now} />}
        {section === 'commits' && <CommitsSection key={selectedBranch ?? ''} branch={selectedBranch} page={route.page} onPage={openPage} now={now} />}
        {section === 'prs' && <PullsSection key={selectedBranch ?? ''} branch={selectedBranch} page={route.page} onPage={openPage} now={now} />}
      </div>
    </>
  );
}

export function App() {
  const trpc = useTRPC();
  const now = useNow();
  const live = useLiveUpdates();
  const { route, navigate, openTop, openSection } = useRoute();

  // Heartbeats change every 15 s without an update message, so the overview also refreshes on a timer
  const overview = useQuery({ ...trpc.overview.queryOptions(), refetchInterval: 15_000 });
  const integrations = useQuery({ ...trpc.integrations.queryOptions(), refetchInterval: 60_000 });
  const data = overview.data;
  const api = data?.api;

  const worstIntegration = (integrations.data ?? []).some((i) => i.level === 'error')
    ? 'bad'
    : (integrations.data ?? []).some((i) => i.level === 'degraded')
      ? 'warn'
      : 'ok';
  const systemDown = data ? data.services.some((s) => !s.up) || data.source?.ok === false : false;

  const top: TabItem[] = TOP_TABS.map((t) => ({
    id: t.id,
    label: (
      <>
        {/* Always rendered (grey until loaded), so a tab does not grow when data arrives */}
        <Dot
          tone={
            !data
              ? 'muted'
              : t.id === 'system'
                ? systemDown
                  ? 'bad'
                  : worstIntegration
                : t.id === 'status'
                  ? statusTone(data.statusLevel)
                  : levelTone(data.overall.level)
          }
        />{' '}
        <TabLabel text={t.label} />
      </>
    ),
  }));

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>labwatch</h1>
          <p className="muted small">{data?.repos.join(', ') ?? 'loading…'}</p>
        </div>
        <div className="top-meta small">
          {data && data.overall.issues.length > 0 && <span className="top-issues">{data.overall.issues.join(' · ')}</span>}
          <span className={`live live-${live.state}`} title={live.lastUpdate ? `last update ${formatDate(live.lastUpdate)}` : undefined}>
            <Dot tone={live.state === 'live' ? 'ok' : live.state === 'offline' ? 'bad' : 'muted'} pulse={live.state === 'live'} />
            {live.state}
          </span>
          {api && (
            <span className="muted" title={api.resetAt ? `GitHub reports ${api.remaining}/${api.limit} left, resets ${formatDate(api.resetAt)}` : undefined}>
              GitHub API {api.used}/{api.budgetPerHour} ({api.authenticated ? 'token' : api.tokenRejected ? 'token rejected' : 'no token'})
            </span>
          )}
        </div>
      </header>

      {overview.isError && <p className="banner banner-bad">Gateway unreachable: {overview.error.message}</p>}

      <TabList items={top} selectedId={route.top} onSelect={(id) => openTop(id as Route['top'])} label="Views" variant="top" panelId={PANEL_ID} />

      <main id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-top-${route.top}`}>
        {route.top === 'system' && <SystemView overview={data} now={now} />}
        {route.top === 'status' && <StatusSection scale={route.scale} onScale={(scale) => navigate({ top: 'status', scale })} now={now} />}
        {route.top === 'repo' && <RepositoryView route={route} overview={data} navigate={navigate} openSection={openSection} now={now} />}
      </main>
    </div>
  );
}
