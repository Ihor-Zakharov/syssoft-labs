import type { ServiceHealth } from '@labwatch/shared';
import { timeAgo } from '../format';
import { Dot } from './Badge';

export function HealthTiles({ services, now }: { services: ServiceHealth[]; now: number }) {
  return (
    <section className="tiles" aria-label="Services">
      {services.map((s) => (
        <article key={s.name} className={`tile ${s.up ? '' : 'tile-down'}`} title={s.detail ?? undefined}>
          <header>
            <Dot tone={s.up ? 'ok' : 'bad'} />
            <h3>{s.name}</h3>
            <span className="muted small">{s.kind === 'service' ? 'heartbeat' : 'ping'}</span>
          </header>
          <p className="tile-state">{s.up ? 'up' : 'down'}</p>
          <p className="muted small">
            {s.kind === 'service'
              ? s.up
                ? `beat ${timeAgo(s.lastSeen, now)}`
                : (s.detail ?? 'no heartbeat')
              : s.up
                ? `${s.latencyMs ?? '?'} ms`
                : (s.detail ?? 'unreachable')}
            {s.version ? ` · v${s.version}` : ''}
          </p>
        </article>
      ))}
    </section>
  );
}
