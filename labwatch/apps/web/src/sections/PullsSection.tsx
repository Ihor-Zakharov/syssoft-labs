import { PAGE_SIZE, type PrComment, type PrReview, type PullRow } from '@labwatch/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, lazy, Suspense, useState } from 'react';
import { AreaBadges, Badge, ReviewBadge, ReviewStateBadge, runLabel, runTone, type Tone } from '../components/Badge';
import { NewerNotice, Pager, usePageAnchor, useRememberAnchor } from '../components/Pager';
import { formatDate, timeAgo } from '../format';
import { useTRPC } from '../trpc';

// The Markdown renderer is only needed once a PR is expanded: keep it out of the main bundle
const LazyMarkdown = lazy(() => import('../components/Markdown').then((m) => ({ default: m.Markdown })));

function Markdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<pre className="md-fallback">{children}</pre>}>
      <LazyMarkdown>{children}</LazyMarkdown>
    </Suspense>
  );
}

function stateBadge(p: PullRow): { tone: Tone; label: string } {
  if (p.merged) return { tone: 'run', label: 'merged' };
  if (p.state === 'open') return p.draft ? { tone: 'muted', label: 'draft' } : { tone: 'ok', label: 'open' };
  return { tone: 'muted', label: 'closed' };
}

function groupReviews(reviews: PrReview[]) {
  const groups = new Map<string, { author: string | null; state: string; count: number; latest: PrReview; bodies: PrReview[] }>();
  for (const r of reviews) {
    const key = `${r.author}/${r.state}`;
    const group = groups.get(key) ?? { author: r.author, state: r.state, count: 0, latest: r, bodies: [] };
    group.count++;
    if ((r.submittedAt ?? '') >= (group.latest.submittedAt ?? '')) group.latest = r;
    if (r.body.trim()) group.bodies.push(r);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function Comment({ comment, now }: { comment: PrComment; now: number }) {
  return (
    <article className="comment">
      <header className="small">
        <strong>{comment.author ?? 'unknown'}</strong>
        {comment.kind === 'inline' && comment.path && (
          <span className="mono location">
            {comment.path}
            {comment.line !== null ? `:${comment.line}` : ''}
          </span>
        )}
        {comment.inReplyToId !== null && <span className="muted">reply</span>}
        <a href={comment.htmlUrl} target="_blank" rel="noreferrer" title={formatDate(comment.createdAt)}>
          {timeAgo(comment.createdAt, now)} ↗
        </a>
      </header>
      <Markdown>{comment.body}</Markdown>
    </article>
  );
}

function PullDetail({ number, now }: { number: number; now: number }) {
  const trpc = useTRPC();
  const detail = useQuery(trpc.pull.queryOptions({ number }));
  if (detail.isPending) return <p className="muted small">Loading…</p>;
  if (!detail.data) return <p className="muted small">Pull request not found.</p>;
  const { pull, reviews, comments } = detail.data;
  const inline = comments.filter((c) => c.kind === 'inline');
  const conversation = comments.filter((c) => c.kind === 'issue');
  // Reviews that only carry inline comments have no text: one line per reviewer and state
  const groups = groupReviews(reviews);

  return (
    <div className="detail">
      {pull.lastReview?.kind === 'no_comments' && (
        <p className="notice">The latest review run finished without posting anything (review ran, no comments).</p>
      )}
      <section>
        <h3>
          Reviews <span className="muted small">{reviews.length}</span>
        </h3>
        {groups.length === 0 ? (
          <p className="muted small">No reviews yet.</p>
        ) : (
          <ul className="list">
            {groups.map((g) => (
              <li key={`${g.author}/${g.state}`}>
                <div className="small">
                  <strong>{g.author ?? 'unknown'}</strong>{' '}
                  <Badge tone={g.state === 'APPROVED' ? 'ok' : g.state === 'CHANGES_REQUESTED' ? 'bad' : 'run'}>{g.state.toLowerCase().replace('_', ' ')}</Badge>
                  {g.count > 1 && <span className="muted"> ×{g.count}</span>}{' '}
                  {g.latest.htmlUrl && (
                    <a href={g.latest.htmlUrl} target="_blank" rel="noreferrer">
                      {g.latest.submittedAt ? timeAgo(g.latest.submittedAt, now) : 'open'} ↗
                    </a>
                  )}
                </div>
                {g.bodies.map((r) => (
                  <Markdown key={r.id}>{r.body}</Markdown>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>
          Inline comments <span className="muted small">{inline.length}</span>
        </h3>
        {inline.length === 0 ? <p className="muted small">None.</p> : inline.map((c) => <Comment key={c.id} comment={c} now={now} />)}
      </section>
      {conversation.length > 0 && (
        <section>
          <h3>
            Conversation <span className="muted small">{conversation.length}</span>
          </h3>
          {conversation.map((c) => (
            <Comment key={c.id} comment={c} now={now} />
          ))}
        </section>
      )}
    </div>
  );
}

export function PullsSection({ branch, page, onPage, now }: { branch: string | null; page: number; onPage: (page: number) => void; now: number }) {
  const trpc = useTRPC();
  const { anchor, remember } = usePageAnchor(page, branch ?? '');
  const pulls = useQuery({ ...trpc.pulls.queryOptions({ branch, page, pageSize: PAGE_SIZE, anchor }), placeholderData: keepPreviousData });
  useRememberAnchor(pulls.isPlaceholderData ? undefined : pulls.data, page, remember, onPage);
  const data = pulls.data?.rows ?? [];
  const [expanded, setExpanded] = useState<number | null>(null);
  // On a branch tab with a single PR its details are what you came for: open them
  const openNumber = branch && data.length === 1 && expanded === null ? data[0]!.number : expanded;

  return (
    <section className="card" aria-label="Pull requests">
      <div className="card-head">
        <h2>{branch ? `Pull requests from ${branch}` : 'Pull requests · all branches'}</h2>
        <span className="muted small">
          {data.filter((p) => p.state === 'open').length} open{pulls.data ? ` · ${pulls.data.total} total` : ''}
        </span>
      </div>
      <NewerNotice paged={pulls.data} onLatest={() => onPage(1)} noun="update" />
      {pulls.isPending ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="muted">{branch ? 'No pull request for this branch.' : 'No pull requests collected yet.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="fixed">
            <colgroup>
              <col style={{ width: 40 }} />
              <col />
              {!branch && <col style={{ width: 150 }} />}
              <col style={{ width: 250 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Details" />
                <th>Pull request</th>
                {!branch && <th>Branch</th>}
                <th>Review</th>
                <th>Checks</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const open = openNumber === p.number;
                const state = stateBadge(p);
                return (
                  <Fragment key={p.number}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="expander"
                          aria-expanded={open}
                          aria-label={`${open ? 'Hide' : 'Show'} review of #${p.number}`}
                          onClick={() => setExpanded(open ? -1 : p.number)}
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>
                        <Badge tone={state.tone}>{state.label}</Badge>{' '}
                        <a href={p.htmlUrl} target="_blank" rel="noreferrer">
                          #{p.number}
                        </a>{' '}
                        <span className="clip">{p.title}</span>
                        <div className="muted small">
                          <span className="mono">
                            {p.baseRef} ← {p.headRef}
                          </span>{' '}
                          · {p.author ?? 'unknown'} {p.areas && p.areas.length > 0 && <AreaBadges areas={p.areas} />}
                        </div>
                      </td>
                      {!branch && <td className="mono small">{p.headRef}</td>}
                      <td>
                        <ReviewStateBadge state={p.reviewState} />{' '}
                        {p.findings > 0 && (
                          <Badge tone="warn" title="Top-level inline review comments">
                            {p.findings} finding{p.findings === 1 ? '' : 's'}
                          </Badge>
                        )}{' '}
                        {p.lastReview?.kind === 'no_comments' || p.lastReview?.kind === 'running' || p.lastReview?.kind === 'failed' ? (
                          <ReviewBadge outcome={p.lastReview} />
                        ) : null}
                      </td>
                      <td>
                        <div className="jobs">
                          {p.checks.length === 0 ? (
                            <span className="muted small">none</span>
                          ) : (
                            p.checks.map((c) => (
                              <a key={c.workflowName} href={c.htmlUrl} target="_blank" rel="noreferrer">
                                <Badge tone={runTone(c.status, c.conclusion)} title={runLabel(c.status, c.conclusion)}>
                                  {c.workflowName}
                                </Badge>
                              </a>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="small" title={formatDate(p.updatedAt)}>
                        {timeAgo(p.updatedAt, now)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={branch ? 5 : 6}>
                          <PullDetail number={p.number} now={now} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager paged={pulls.data} onPage={onPage} label="Pull requests" />
    </section>
  );
}
