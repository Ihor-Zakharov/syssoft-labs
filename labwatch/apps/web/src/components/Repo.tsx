import type { CommitsView, PullRequest } from '@labwatch/shared';
import { firstLine, formatDate, shortSha, timeAgo } from '../format';
import { Badge } from './Badge';

export function Commits({ view, now }: { view: CommitsView | undefined; now: number }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Commits</h2>
        <span className="muted small">{view?.branches.length ?? 0} branches</span>
      </div>
      <div className="chips">
        {view?.branches.map((b) => (
          <span key={b.name} className="chip mono small" title={b.headSha}>
            {b.name} <span className="muted">{shortSha(b.headSha)}</span>
          </span>
        ))}
      </div>
      <ul className="list">
        {view?.commits.map((c) => (
          <li key={c.sha}>
            <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="mono small">
              {shortSha(c.sha)}
            </a>{' '}
            <span className="clip">{firstLine(c.message)}</span>
            <div className="muted small">
              {c.authorLogin ?? c.authorName ?? 'unknown'} · <span title={formatDate(c.committedAt)}>{timeAgo(c.committedAt, now)}</span>
              {c.verified && (
                <>
                  {' '}
                  · <Badge tone="ok">verified</Badge>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function pullTone(p: PullRequest) {
  if (p.merged) return 'run' as const;
  if (p.state === 'open') return p.draft ? ('muted' as const) : ('ok' as const);
  return 'muted' as const;
}

export function Pulls({ pulls, now }: { pulls: PullRequest[] | undefined; now: number }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Pull requests</h2>
        <span className="muted small">{pulls?.filter((p) => p.state === 'open').length ?? 0} open</span>
      </div>
      <ul className="list">
        {pulls?.map((p) => (
          <li key={`${p.repo}#${p.number}`}>
            <Badge tone={pullTone(p)}>{p.merged ? 'merged' : p.draft ? 'draft' : p.state}</Badge>{' '}
            <a href={p.htmlUrl} target="_blank" rel="noreferrer">
              #{p.number}
            </a>{' '}
            <span className="clip">{p.title}</span>
            <div className="muted small">
              <span className="mono">
                {p.headRef} → {p.baseRef}
              </span>{' '}
              · {p.author ?? 'unknown'} · updated <span title={formatDate(p.updatedAt)}>{timeAgo(p.updatedAt, now)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
