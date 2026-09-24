import type { CiJob } from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { Dot } from './components/Badge';
import { CiRuns } from './components/CiRuns';
import { EventFeed } from './components/EventFeed';
import { HealthTiles } from './components/HealthTiles';
import { Commits, Pulls } from './components/Repo';
import { SourceCard } from './components/SourceCard';
import { formatDate, timeAgo, useNow } from './format';
import { useLiveUpdates } from './live';
import { useTRPC } from './trpc';

export function App() {
  const trpc = useTRPC();
  const now = useNow();
  const live = useLiveUpdates();

  // Heartbeats change every 15 s without an update message, so the overview also refreshes on a timer
  const overview = useQuery({ ...trpc.overview.queryOptions(), refetchInterval: 15_000 });
  const runs = useQuery(trpc.ciRuns.queryOptions({ limit: 25 }));
  const probes = useQuery(trpc.sourceProbes.queryOptions({ limit: 60 }));
  const commits = useQuery(trpc.commits.queryOptions({ limit: 15 }));
  const pulls = useQuery(trpc.pulls.queryOptions({ limit: 10 }));
  const events = useQuery(trpc.events.queryOptions({ limit: 30 }));

  const data = overview.data;
  const jobs: Record<string, CiJob[]> = Object.assign({}, ...(data?.ci.map((c) => c.jobs) ?? []));
  const rate = data?.rateLimit;

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
          {rate && (
            <span className="muted" title={`resets ${formatDate(rate.resetAt)}`}>
              GitHub API {rate.remaining}/{rate.limit}
              {rate.authenticated ? '' : ' (no token)'}
            </span>
          )}
          {data && <span className="muted">refreshed {timeAgo(data.generatedAt, now)}</span>}
        </div>
      </header>

      {overview.isError && <p className="banner">Gateway unreachable: {overview.error.message}</p>}

      {data && <HealthTiles services={data.services} now={now} />}

      <div className="grid">
        <SourceCard source={data?.source ?? null} probes={probes.data ?? []} now={now} />
        <EventFeed events={events.data} now={now} />
        <CiRuns runs={runs.data ?? []} jobs={jobs} now={now} />
        <Commits view={commits.data} now={now} />
        <Pulls pulls={pulls.data} now={now} />
      </div>
    </div>
  );
}
