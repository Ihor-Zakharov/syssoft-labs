import type { SourceProbe, SourceStatus } from '@labwatch/shared';
import { formatDate, timeAgo } from '../format';
import { Badge, Dot } from './Badge';

function fingerprint(fp: string | null): string {
  if (!fp) return '—';
  const hex = fp.replace(/:/g, '');
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

/** Latency of recent probes, oldest → newest; failed probes are red bars at full height. */
function LatencyBars({ probes }: { probes: SourceProbe[] }) {
  const slots = 60;
  const recent = [...probes].reverse().slice(-slots);
  if (recent.length === 0) return null;
  const max = Math.max(50, ...recent.map((p) => p.latencyMs ?? 0));
  const width = 240;
  const height = 36;
  const bar = width / slots;
  // Newest probe at the right edge; empty slots on the left until 60 probes (5 hours) exist
  const offset = slots - recent.length;
  return (
    <svg className="bars" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Latency of recent probes">
      {recent.map((p, i) => {
        const h = p.ok ? Math.max(2, ((p.latencyMs ?? 0) / max) * height) : height;
        return (
          <rect key={p.checkedAt} x={(offset + i) * bar + 0.5} y={height - h} width={bar - 1} height={h} className={p.ok ? 'bar-ok' : 'bar-bad'}>
            <title>{`${formatDate(p.checkedAt)}: ${p.ok ? `${p.latencyMs} ms` : (p.error ?? `HTTP ${p.httpStatus}`)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function SourceCard({ source, probes, now }: { source: SourceStatus | null; probes: SourceProbe[]; now: number }) {
  if (!source) {
    return (
      <section className="card">
        <h2>Lab source</h2>
        <p className="muted">No probe yet — the collector checks every 5 minutes.</p>
      </section>
    );
  }
  const up = probes.filter((p) => p.ok).length;
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <Dot tone={source.ok ? 'ok' : 'bad'} /> Lab source
        </h2>
        <Badge tone={source.ok ? 'ok' : 'bad'}>{source.ok ? 'up' : 'down'}</Badge>
      </div>
      <p className="mono small break">{source.url}</p>
      <dl className="facts">
        <dt>Checked</dt>
        <dd title={formatDate(source.checkedAt)}>{timeAgo(source.checkedAt, now)}</dd>
        <dt>HTTP</dt>
        <dd>
          {source.httpStatus ?? '—'} {source.latencyMs !== null && <span className="muted">· {source.latencyMs} ms</span>}
        </dd>
        <dt>Content</dt>
        <dd>
          {source.bodyMatches === null ? (
            <span className="muted">not checked</span>
          ) : (
            <Badge tone={source.bodyMatches ? 'ok' : 'warn'} title={source.bodySha256 ?? undefined}>
              {source.bodyMatches ? 'unchanged' : 'changed'}
            </Badge>
          )}{' '}
          <span className="muted small">{source.bodyBytes ?? '?'} bytes</span>
        </dd>
        <dt>Certificate</dt>
        <dd>
          <Badge tone={source.certPinned ? 'ok' : 'bad'} title={source.certSha256 ?? undefined}>
            {source.certPinned ? 'pinned' : 'not pinned'}
          </Badge>{' '}
          <span className="mono small">{fingerprint(source.certSha256)}</span>
        </dd>
        <dt>TLS check</dt>
        <dd className="small">
          {source.tlsError ?? 'valid'} <span className="muted">· {source.certSubject ?? '?'}, expires {formatDate(source.certValidTo)}</span>
        </dd>
        {source.error && (
          <>
            <dt>Error</dt>
            <dd className="text-bad">{source.error}</dd>
          </>
        )}
      </dl>
      <LatencyBars probes={probes} />
      <p className="muted small">
        {probes.length > 0 ? `${up}/${probes.length} probes OK (${Math.round((up / probes.length) * 100)}% uptime)` : ''}
      </p>
    </section>
  );
}
