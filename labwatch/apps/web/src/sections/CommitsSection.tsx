import { compareAreas, labArea, PAGE_SIZE, type CommitRow } from '@labwatch/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AreaBadges, Badge } from '../components/Badge';
import { NewerNotice, Pager, usePageAnchor, useRememberAnchor } from '../components/Pager';
import { firstLine, formatDate, shortSha, timeAgo } from '../format';
import { useTRPC } from '../trpc';

/** Every lab of the repository plus the fixed areas, and whatever else the page shows. */
function areaFilters(labs: number[], commits: CommitRow[], selected: string | null): string[] {
  const areas = new Set<string>([...labs.map(labArea), 'Infra', 'CI', 'Repo']);
  for (const c of commits) c.areas?.forEach((a) => areas.add(a));
  if (selected) areas.add(selected);
  return [...areas].sort(compareAreas);
}

export function CommitsSection({ branch, page, onPage, now }: { branch: string | null; page: number; onPage: (page: number) => void; now: number }) {
  const trpc = useTRPC();
  const [area, setArea] = useState<string | null>(null);
  const { anchor, remember } = usePageAnchor(page, `${branch ?? ''}|${area ?? ''}`);
  // The area filter runs on the server, so the pages count only matching commits
  const view = useQuery({ ...trpc.commits.queryOptions({ branch, area, page, pageSize: PAGE_SIZE, anchor }), placeholderData: keepPreviousData });
  useRememberAnchor(view.isPlaceholderData ? undefined : view.data?.commits, page, remember, onPage);
  const data = view.data;
  const commits = data?.commits.rows ?? [];
  const filters = data ? areaFilters(data.labs, commits, area) : [];
  const shown = commits;
  const selectArea = (next: string | null) => {
    setArea(next);
    if (page !== 1) onPage(1);
  };
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
          <button type="button" className={`chip${area === null ? ' chip-on' : ''}`} aria-pressed={area === null} onClick={() => selectArea(null)}>
            All
          </button>
          {filters.map((a) => (
            <button key={a} type="button" className={`chip${area === a ? ' chip-on' : ''}`} aria-pressed={area === a} onClick={() => selectArea(area === a ? null : a)}>
              {a}
            </button>
          ))}
        </div>
      )}

      <NewerNotice paged={data?.commits} onLatest={() => onPage(1)} noun="commit" />

      {view.isPending ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{area ? `No commits touch ${area}.` : 'No commits collected yet.'}</p>
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
      <Pager paged={data?.commits} onPage={onPage} label="Commits" />
    </section>
  );
}
