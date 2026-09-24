import type { ApiUsage, Overview, StoredEvent } from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate, timeAgo } from '../format';
import { useTRPC } from '../trpc';
import { Dot, levelTone } from './Badge';
import { EventFeed } from './EventFeed';
import { SourceCard } from './SourceCard';

function apiText(api: ApiUsage): string {
  return `GitHub API: ${api.used}/${api.budgetPerHour} this hour (${api.authenticated ? 'token' : 'no token'})`;
}

/** Overview header: services, manual.txt source, GitHub budget and the latest events (collapsible). */
export function SummaryStrip({ overview, now }: { overview: Overview | undefined; now: number }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState<'source' | 'events' | null>(null);
  const events = useQuery(trpc.events.queryOptions({ limit: 20 }));
  const probes = useQuery({ ...trpc.sourceProbes.queryOptions({ limit: 60 }), enabled: open === 'source' });

  if (!overview) return <section className="strip muted small">Loading…</section>;
  const source = overview.source;
  const latest: StoredEvent | undefined = events.data?.[0];
  const toggle = (panel: 'source' | 'events') => setOpen((o) => (o === panel ? null : panel));

  return (
    <section className="strip-wrap" aria-label="Summary">
      <div className="strip">
        {overview.overall.issues.length > 0 && (
          <span className="strip-item strip-issues">
            <Dot tone={levelTone(overview.overall.level)} /> {overview.overall.issues.join(' · ')}
          </span>
        )}
        <span className="strip-item" aria-label="Services">
          {overview.services.map((s) => (
            <span
              key={s.name}
              className="service"
              title={`${s.name}: ${s.up ? 'up' : 'down'}${s.latencyMs !== null ? `, ${s.latencyMs} ms` : ''}${s.lastSeen ? `, seen ${timeAgo(s.lastSeen, now)}` : ''}${s.version ? `, v${s.version}` : ''}${s.detail && !s.up ? ` — ${s.detail}` : ''}`}
            >
              <Dot tone={s.up ? 'ok' : 'bad'} label={`${s.name} ${s.up ? 'up' : 'down'}`} />
              {s.name}
            </span>
          ))}
        </span>
        <button type="button" className="strip-item strip-button" aria-expanded={open === 'source'} onClick={() => toggle('source')}>
          <Dot tone={source === null ? 'muted' : source.ok ? 'ok' : 'bad'} />
          manual.txt {source === null ? 'not checked yet' : source.ok ? 'up' : 'down'}
          {source?.bodyMatches === false && ' · content changed'}
          {source && <span className="muted small"> · {timeAgo(source.checkedAt, now)}</span>}
        </button>
        {overview.api && (
          <span
            className="strip-item muted small"
            title={overview.api.resetAt ? `GitHub reports ${overview.api.remaining}/${overview.api.limit} left until ${formatDate(overview.api.resetAt)}` : undefined}
          >
            {apiText(overview.api)}
          </span>
        )}
        <button type="button" className="strip-item strip-button strip-events" aria-expanded={open === 'events'} onClick={() => toggle('events')}>
          {latest ? (
            <>
              <Dot tone={latest.severity === 'error' ? 'bad' : latest.severity === 'warning' ? 'warn' : 'ok'} />
              <span className="clip">{latest.title}</span>
              <span className="muted small"> · {timeAgo(latest.at, now)}</span>
            </>
          ) : (
            <span className="muted">No events yet</span>
          )}
          <span className="muted small"> {open === 'events' ? '▴' : '▾'} events</span>
        </button>
      </div>
      {open === 'source' && <SourceCard source={source} probes={probes.data ?? []} now={now} />}
      {open === 'events' && <EventFeed events={events.data} now={now} />}
    </section>
  );
}
