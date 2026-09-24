import {
  STATUS_LEVEL_LABELS,
  STATUS_SCALES,
  STATUS_SCALE_KEYS,
  formatUptime,
  uptimeTone,
  type StatusScale,
  type StatusTargetView,
  type UptimeBucket,
} from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Dot, statusTone } from '../components/Badge';
import { formatDate, formatDay, formatSeconds, formatTime, timeAgo } from '../format';
import { useTRPC } from '../trpc';

const STATE_LABEL: Record<StatusTargetView['state'], string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  no_data: 'No data',
};

const STATE_TONE = { operational: 'ok', degraded: 'warn', down: 'bad', no_data: 'muted' } as const;

function bucketPeriod(b: UptimeBucket, scale: StatusScale): string {
  const day = STATUS_SCALES[scale].bucketSeconds >= 86_400;
  return day ? formatDay(b.start) : `${formatDay(b.start)}, ${formatTime(b.start)} – ${formatTime(b.end)}`;
}

function bucketSummary(b: UptimeBucket): string {
  if (b.total === 0) return 'No data';
  const latency = b.avgLatencyMs !== null ? ` · avg ${b.avgLatencyMs} ms, p95 ${b.p95LatencyMs ?? '—'} ms` : '';
  return `${formatUptime(b.uptime)} uptime${latency} · ${b.down} failed of ${b.total} checks${b.degraded ? `, ${b.degraded} slow` : ''}`;
}

/** Uptime bars; the row is one focusable control: arrow keys move through the buckets. */
function UptimeBars({ target, scale }: { target: StatusTargetView; scale: StatusScale }) {
  const [active, setActive] = useState<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const buckets = target.buckets;
  const shown = active !== null ? buckets[active] : undefined;

  const onKey = (e: KeyboardEvent) => {
    const last = buckets.length - 1;
    const current = active ?? last;
    const next = { ArrowRight: Math.min(last, current + 1), ArrowLeft: Math.max(0, current - 1), Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div className="bars-wrap">
      <div
        ref={row}
        className="uptime-bars"
        tabIndex={0}
        role="group"
        aria-label={`${target.name}: uptime per ${scale === '1h' ? 'minute' : 'period'}, use arrow keys for details`}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? buckets.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => document.activeElement !== row.current && setActive(null)}
      >
        {buckets.map((b, i) => (
          <span
            key={b.start}
            className={`ubar ubar-${uptimeTone(b.uptime)}${i === active ? ' ubar-active' : ''}`}
            onMouseEnter={() => setActive(i)}
          />
        ))}
      </div>
      <div className="bars-axis muted small" aria-hidden>
        <span>{STATUS_SCALES[scale].label} ago</span>
        <span>now</span>
      </div>
      <div className="bar-tip small" aria-live="polite">
        {shown ? (
          <>
            <strong>{bucketPeriod(shown, scale)}</strong> · {bucketSummary(shown)}
          </>
        ) : (
          ' '
        )}
      </div>
    </div>
  );
}

function TargetRow({ target, scale, now }: { target: StatusTargetView; scale: StatusScale; now: number }) {
  const current = target.current;
  return (
    <li className="target">
      <div className="target-head">
        <div className="target-name">
          <Dot tone={STATE_TONE[target.state]} label={STATE_LABEL[target.state]} />
          <strong>{target.name}</strong>
          <a className="muted small mono" href={target.url} target="_blank" rel="noreferrer">
            {target.url.replace(/^https?:\/\//, '')}
          </a>
          {current?.tlsOk === false && (
            <span className="tls-chip" title={`Certificate check failed: ${current.tlsError ?? 'not trusted'} — the site still answers, so this is not counted as an outage`}>
              TLS: {current.tlsError ?? 'not trusted'}
            </span>
          )}
        </div>
        <div className="target-stats small">
          <span className={`text-${STATE_TONE[target.state]}`}>{STATE_LABEL[target.state]}</span>
          <span title="Uptime over the selected period">{formatUptime(target.uptime)}</span>
          <span className="mono" title={current ? `HTTP ${current.httpStatus ?? '—'}, checked ${formatDate(current.checkedAt)}` : undefined}>
            {current?.latencyMs != null ? `${current.latencyMs} ms` : '—'}
          </span>
        </div>
      </div>
      <UptimeBars target={target} scale={scale} />
      {current && target.state === 'down' && <p className="text-bad small">Last check {timeAgo(current.checkedAt, now)}: {current.error ?? `HTTP ${current.httpStatus}`}</p>}
    </li>
  );
}

export function StatusSection({ scale, onScale, now }: { scale: StatusScale; onScale: (scale: StatusScale) => void; now: number }) {
  const trpc = useTRPC();
  const page = useQuery({ ...trpc.statusPage.queryOptions({ scale }), refetchInterval: 60_000, placeholderData: (previous) => previous });
  const incidents = useQuery(trpc.incidents.queryOptions({ limit: 20 }));
  const data = page.data;

  return (
    <div className="status-page">
      <div className="scale-switch" role="radiogroup" aria-label="Period">
        {STATUS_SCALE_KEYS.map((key) => (
          <button key={key} type="button" role="radio" aria-checked={key === scale} className={`chip${key === scale ? ' chip-on' : ''}`} onClick={() => onScale(key)}>
            {key}
          </button>
        ))}
      </div>

      {data ? (
        <>
          <div className={`banner banner-${statusTone(data.level)}`} role="status">
            <strong>{STATUS_LEVEL_LABELS[data.level]}</strong>
            <span className="small">
              Checked from <span className="mono">{data.vantage}</span> every minute · updated {timeAgo(data.generatedAt, now)}
            </span>
          </div>

          {data.groups.map((group) => (
            <section key={group.name} className="card">
              <h2>{group.name}</h2>
              <ul className="targets">
                {group.targets.map((t) => (
                  <TargetRow key={t.id} target={t} scale={scale} now={now} />
                ))}
              </ul>
            </section>
          ))}
          <p className="legend muted small">
            <span className="ubar ubar-great" /> ≥ 99.9 % <span className="ubar ubar-good" /> ≥ 99 % <span className="ubar ubar-fair" /> ≥ 95 %{' '}
            <span className="ubar ubar-poor" /> &lt; 95 % <span className="ubar ubar-none" /> no data · slow answers (&gt; 2 s) count as up; TLS problems are shown but not
            counted as outages.
          </p>
        </>
      ) : (
        <p className="muted">{page.isError ? `Status page unavailable: ${page.error.message}` : 'Loading…'}</p>
      )}

      <section className="card">
        <h2>Past incidents</h2>
        {!incidents.data || incidents.data.length === 0 ? (
          <p className="muted">No incidents recorded.</p>
        ) : (
          <ul className="list">
            {incidents.data.map((i) => (
              <li key={i.id}>
                <div>
                  <Badge tone={i.resolvedAt ? 'muted' : 'bad'}>{i.resolvedAt ? 'resolved' : 'ongoing'}</Badge> <strong>{i.targetName}</strong> was down
                  {i.lastError && <span className="muted"> ({i.lastError})</span>}
                </div>
                <div className="muted small">
                  {formatDate(i.startedAt)} – {i.resolvedAt ? formatDate(i.resolvedAt) : 'now'} · {formatSeconds(i.durationS)} · {i.failedChecks} failed check
                  {i.failedChecks === 1 ? '' : 's'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
