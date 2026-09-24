export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'none';

export interface ReviewLike {
  author: string | null;
  state: string;
  submittedAt: string | null;
}

/**
 * GitHub-style review decision: per reviewer the latest decisive review (approve / request changes /
 * dismissed) counts; a later plain comment does not undo an approval. Any reviewer requesting
 * changes wins over approvals.
 */
export function aggregateReviewState(reviews: readonly ReviewLike[]): ReviewState {
  if (reviews.length === 0) return 'none';
  const decisive = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  for (const review of sorted) {
    const state = review.state.toUpperCase();
    if (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED') {
      decisive.set(review.author ?? '?', state);
    }
  }
  const states = [...decisive.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return reviews.some((r) => r.state.toUpperCase() !== 'PENDING') ? 'commented' : 'none';
}

export interface InlineCommentLike {
  author: string | null;
  inReplyToId: number | null;
  createdAt: string;
}

/** Findings = top-level inline comments by someone other than the PR author (replies are discussion). */
export function countFindings(comments: readonly InlineCommentLike[], prAuthor: string | null): number {
  return comments.filter((c) => c.inReplyToId === null && c.author !== prAuthor).length;
}

export interface ReviewRunLike {
  status: string;
  conclusion: string | null;
  createdAt: string;
  runStartedAt: string | null;
  updatedAt: string;
}

export interface ReviewPostLike {
  kind: 'inline' | 'issue' | 'review';
  author: string | null;
  createdAt: string;
  inReplyToId?: number | null;
}

export type ReviewRunOutcome =
  | { kind: 'running' }
  | { kind: 'failed' }
  | { kind: 'no_comments' }
  | { kind: 'posted'; findings: number };

/** Comments can be posted a little after the run is marked complete (buffered inline comments). */
export const REVIEW_POST_SLACK_MS = 5 * 60 * 1000;

/**
 * What an agentic review run produced, judged by what was posted on the PR while it ran:
 * inline comments are findings; a run that finished without posting anything is "no comments".
 */
export function reviewRunOutcome(
  run: ReviewRunLike,
  posts: readonly ReviewPostLike[],
  prAuthor: string | null,
  slackMs = REVIEW_POST_SLACK_MS,
): ReviewRunOutcome {
  if (run.status !== 'completed') return { kind: 'running' };
  if (run.conclusion !== 'success') return { kind: 'failed' };
  const from = new Date(run.runStartedAt ?? run.createdAt).getTime();
  const to = new Date(run.updatedAt).getTime() + slackMs;
  const during = posts.filter((p) => {
    const at = new Date(p.createdAt).getTime();
    return at >= from && at <= to && p.author !== prAuthor;
  });
  if (during.length === 0) return { kind: 'no_comments' };
  return { kind: 'posted', findings: during.filter((p) => p.kind === 'inline' && !p.inReplyToId).length };
}
