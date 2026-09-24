import { arrangeBranchTabs, type BranchSummary } from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CI_STATE_LABEL, Dot, ciTone, levelTone, statusTone } from './components/Badge';
import { SummaryStrip } from './components/SummaryStrip';
import { OverflowMenu, TabList, type TabItem } from './components/Tabs';
import { formatDate, useNow } from './format';
import { useLiveUpdates } from './live';
import { SECTIONS, useRoute, type Section } from './route';
import { CiSection } from './sections/CiSection';
import { CommitsSection } from './sections/CommitsSection';
import { PullsSection } from './sections/PullsSection';
import { StatusSection } from './sections/StatusSection';
import { useTRPC } from './trpc';

const PANEL_ID = 'panel';

function branchTab(b: BranchSummary): TabItem {
  const extra = [CI_STATE_LABEL[b.ciState], b.merged ? 'merged' : null, b.findings ? `${b.findings} review findings` : null].filter(Boolean).join(', ');
  return {
    id: `branch:${b.name}`,
    title: `${b.name} — ${extra}`,
    label: (
      <>
        <Dot tone={ciTone(b.ciState)} />
        <span className="tab-name">{b.name}</span>
        {b.findings > 0 && <span className="tab-count">{b.findings}</span>}
      </>
    ),
  };
}

export function App() {
  const trpc = useTRPC();
  const now = useNow();
  const live = useLiveUpdates();
  const { route, navigate, openSection } = useRoute();

  // Heartbeats change every 15 s without an update message, so the overview also refreshes on a timer
  const overview = useQuery({ ...trpc.overview.queryOptions(), refetchInterval: 15_000 });
  const branches = useQuery(trpc.branches.queryOptions());

  const tabs = useMemo(() => arrangeBranchTabs(branches.data?.branches ?? [], new Date(now)), [branches.data, Math.floor(now / 60_000)]);
  const data = overview.data;
  const api = data?.api;

  const primary: TabItem[] = SECTIONS.map((s) => ({
    id: s.id,
    label:
      s.id === 'status' && data ? (
        <>
          <Dot tone={statusTone(data.statusLevel)} /> {s.label}
        </>
      ) : (
        s.label
      ),
  }));

  const section = route.section;
  const scope = route.section === 'status' ? null : route.scope;
  const selectedBranch = scope?.kind === 'branch' ? scope.name : null;
  const secondaryId = scope ? (scope.kind === 'overview' ? 'overview' : `branch:${scope.name}`) : null;

  const secondary: TabItem[] = [
    {
      id: 'overview',
      title: data ? `Overview — ${data.overall.issues.join('; ') || 'all good'}` : 'Overview',
      label: (
        <>
          <Dot tone={data ? levelTone(data.overall.level) : 'muted'} /> Overview
        </>
      ),
    },
    ...tabs.visible.map(branchTab),
  ];
  // A branch opened from the overflow menu (or a link) gets a temporary tab so the selection stays visible
  const extra = selectedBranch && !secondary.some((t) => t.id === `branch:${selectedBranch}`) ? selectedBranch : null;
  if (extra) {
    const known = tabs.overflow.find((b) => b.name === extra);
    secondary.push(
      known
        ? branchTab(known)
        : { id: `branch:${extra}`, label: <span className="tab-name">{extra}</span>, title: `${extra} (not a current branch)` },
    );
  }

  const selectSecondary = (id: string) => {
    if (section === 'status') return;
    navigate(id === 'overview' ? { section, scope: { kind: 'overview' } } : { section, scope: { kind: 'branch', name: id.slice('branch:'.length) } });
  };

  const branchKnown = !selectedBranch || branches.isPending || (branches.data?.branches ?? []).some((b) => b.name === selectedBranch);

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>labwatch</h1>
          <p className="muted small">{data?.repos.join(', ') ?? 'loading…'}</p>
        </div>
        <div className="top-meta small">
          <span className={`live live-${live.state}`} title={live.lastUpdate ? `last update ${formatDate(live.lastUpdate)}` : undefined}>
            <Dot tone={live.state === 'live' ? 'ok' : live.state === 'offline' ? 'bad' : 'muted'} pulse={live.state === 'live'} />
            {live.state}
          </span>
          {api && (
            <span className="muted" title={api.resetAt ? `GitHub reports ${api.remaining}/${api.limit} left, resets ${formatDate(api.resetAt)}` : undefined}>
              GitHub API {api.used}/{api.budgetPerHour} ({api.authenticated ? 'token' : 'no token'})
            </span>
          )}
        </div>
      </header>

      {overview.isError && <p className="banner banner-bad">Gateway unreachable: {overview.error.message}</p>}

      <TabList items={primary} selectedId={section} onSelect={(id) => openSection(id as Section | 'status')} label="Sections" variant="primary" panelId={PANEL_ID} />

      {section !== 'status' && (
        <TabList
          items={secondary}
          selectedId={secondaryId}
          onSelect={selectSecondary}
          label="Branches"
          variant="secondary"
          panelId={PANEL_ID}
          after={
            <OverflowMenu
              label="Merged and idle branches"
              items={tabs.overflow.filter((b) => b.name !== extra).map(branchTab)}
              onSelect={selectSecondary}
            />
          }
        />
      )}

      <main id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-primary-${section}`} className="panel">
        {route.section === 'status' ? (
          <StatusSection scale={route.scale} onScale={(scale) => navigate({ section: 'status', scale })} now={now} />
        ) : (
          <>
            {scope?.kind === 'overview' && <SummaryStrip overview={data} now={now} />}
            {!branchKnown && <p className="notice">Branch “{selectedBranch}” is not among the current branches; showing what was recorded for it.</p>}
            {section === 'ci' && <CiSection key={selectedBranch ?? ''} branch={selectedBranch} now={now} />}
            {section === 'commits' && <CommitsSection key={selectedBranch ?? ''} branch={selectedBranch} now={now} />}
            {section === 'prs' && <PullsSection key={selectedBranch ?? ''} branch={selectedBranch} now={now} />}
          </>
        )}
      </main>
    </div>
  );
}
