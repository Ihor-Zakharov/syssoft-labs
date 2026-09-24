import type { Paged, StoredEvent } from '@labwatch/shared';
import { formatDate, timeAgo } from '../format';
import { Dot, type Tone } from './Badge';
import { NewerNotice, Pager } from './Pager';

const tone: Record<StoredEvent['severity'], Tone> = { info: 'ok', warning: 'warn', error: 'bad' };

export function EventFeed({ events: paged, onPage, now }: { events: Paged<StoredEvent> | undefined; onPage: (page: number) => void; now: number }) {
  const events = paged?.rows;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Events</h2>
        <span className="muted small">state changes only</span>
      </div>
      <NewerNotice paged={paged} onLatest={() => onPage(1)} noun="event" />
      {!events || events.length === 0 ? (
        <p className="muted">Quiet so far: events appear when something changes state (CI red/green, a site or the source down/up, a service stops).</p>
      ) : (
        <ul className="list feed">
          {events.map((e) => {
            const url = typeof e.data.url === 'string' ? e.data.url : null;
            return (
              <li key={e.id}>
                <Dot tone={tone[e.severity]} />{' '}
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
                <div className="muted small">
                  <span className="mono">{e.kind}</span> · <span title={formatDate(e.at)}>{timeAgo(e.at, now)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager paged={paged} onPage={onPage} label="Events" />
    </section>
  );
}
