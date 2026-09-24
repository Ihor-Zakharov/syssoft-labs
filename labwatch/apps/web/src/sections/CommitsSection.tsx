import { compareAreas, labArea, type CommitRow } from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AreaBadges, Badge } from '../components/Badge';
import { firstLine, formatDate, shortSha, timeAgo } from '../format';
import { useTRPC } from '../trpc';

function areaFilters(labs: number[], commits: CommitRow[]): string[] {
  const areas = new Set<string>(labs.map(labArea));
  for (const c of commits) c.areas?.forEach((a) => areas.add(a));
  return [...areas].sort(compareAreas);
}

export function CommitsSection({ branch, now }: { branch: string | null; now: number }) {
  const trpc = useTRPC();
  const view = useQuery(trpc.commits.queryOptions({ branch, limit: branch ? 30 : 50 }));
  const [area, setArea] = useState<string | null>(null);
  const data = view.data;
  const commits = data?.commits ?? [];
  const filters = data ? areaFilters(data.labs, commits) : [];
  const shown = area ? commits.filter((c) => c.areas?.includes(area)) : commits;
  const compare = data?.compare ?? null;
  const isDefault = branch !== null && branch === data?.defaultBranch;

  return (
    <section className="card" aria-label="Commits">
      <div className="card-head">
        <h2>{branch ? `Commits on ${branch}` : 'Commits · all branches'}</h2>
        {branch && !isDefault && (
          <span className="small" aria-label="Compared with the default branch">
            {compare ? (
              <>
                <Badge tone={compare.aheadBy > 0 ? 'run' : 'muted'}>{compare.aheadBy} ahead</Badge>{' '}
                <Badge tone={compare.behindBy > 0 ? 'warn' : 'muted'}>{compare.behindBy} behind</Badge>{' '}
                <span className="muted">{data?.defaultBranch}</span>
                {compare.areas.length > 0 && (
                  <>
                    {' '}
                    · touches <AreaBadges areas={compare.areas} />
                  </>
                )}
              </>
            ) : (
              <span className="muted">comparison with {data?.defaultBranch} pending</span>
            )}
          </span>
        )}
        {isDefault && <span className="muted small">default branch</span>}
      </div>

      {filters.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by area">
          <button type="button" className={`chip${area === null ? ' chip-on' : ''}`} aria-pressed={area === null} onClick={() => setArea(null)}>
            All
          </button>
          {filters.map((a) => (
            <button key={a} type="button" className={`chip${area === a ? ' chip-on' : ''}`} aria-pressed={area === a} onClick={() => setArea(area === a ? null : a)}>
              {a}
            </button>
          ))}
        </div>
      )}

      {view.isPending ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{commits.length === 0 ? 'No commits collected yet.' : 'No commits touch this area.'}</p>
      ) : (
        <ul className="list">
          {shown.map((c) => (
            <li key={c.sha} className={c.inMain === false ? 'not-in-main' : undefined}>
              <div className="commit-line">
                <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="mono small">
                  {shortSha(c.sha)}
                </a>
                <span className="clip">{firstLine(c.message)}</span>
                {c.inMain === false && (
                  <Badge tone="run" title={`Not on ${data?.defaultBranch} yet`}>
                    not in {data?.defaultBranch}
                  </Badge>
                )}
                <AreaBadges areas={c.areas} />
              </div>
              <div className="muted small">
                {c.authorLogin ?? c.authorName ?? 'unknown'} · <span title={formatDate(c.committedAt)}>{timeAgo(c.committedAt, now)}</span>
                {c.verified && (
                  <>
                    {' '}
                    · <span className="text-ok">verified</span>
                  </>
                )}
                {!branch && c.branches.length > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    {c.branches.map((b) => (
                      <span key={b} className="chip-static mono">
                        {b}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
