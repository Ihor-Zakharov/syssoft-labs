/**
 * How often the periodic GitHub polls run. Everything else (commits of a changed branch, reviews,
 * check runs, commit files, compare) is event-driven: it runs only when a periodic poll saw a change,
 * within the priority budget (see budget.ts). Without a token GitHub allows 60 requests/hour and
 * even 304 answers count, so the periodic polls are stretched to leave room for that work.
 */
export interface PollIntervals {
  /** CI while some run is queued or in progress: watch it live. */
  ciActiveMs: number;
  ciIdleMs: number;
  /** The branch list (heads); commits are fetched only for branches whose head moved. */
  commitsMs: number;
  pullsMs: number;
  /** Event-driven work (reviews, commits, checks, backfill), each call within the budget. */
  syncMs: number;
  /** The university server hosting manual.txt: be polite regardless of auth. */
  sourceMs: number;
  /** How many branches to follow. */
  maxBranches: number;
  /** Whether to fetch per-job details of active runs every CI poll (costs one request per run). */
  fetchJobs: boolean;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const AUTHENTICATED_INTERVALS: PollIntervals = {
  ciActiveMs: 30 * SECOND,
  ciIdleMs: 2 * MINUTE,
  commitsMs: 1 * MINUTE,
  pullsMs: 2 * MINUTE,
  syncMs: 30 * SECOND,
  sourceMs: 5 * MINUTE,
  maxBranches: 30,
  fetchJobs: true,
};

export const UNAUTHENTICATED_INTERVALS: PollIntervals = {
  ciActiveMs: 5 * MINUTE,
  ciIdleMs: 10 * MINUTE,
  commitsMs: 15 * MINUTE,
  pullsMs: 20 * MINUTE,
  syncMs: 2 * MINUTE,
  sourceMs: 5 * MINUTE,
  maxBranches: 30,
  fetchJobs: false,
};

export function intervalsFor(authenticated: boolean): PollIntervals {
  return authenticated ? AUTHENTICATED_INTERVALS : UNAUTHENTICATED_INTERVALS;
}

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Next CI poll: fast while anything is running, slow when idle. */
export function nextCiDelay(runs: ReadonlyArray<{ status: string }>, intervals: PollIntervals): number {
  return runs.some((r) => isActiveStatus(r.status)) ? intervals.ciActiveMs : intervals.ciIdleMs;
}

/** Most jobs requests per CI poll (only for active runs). */
export const MAX_JOB_FETCHES_PER_POLL = 3;

/**
 * Worst-case requests per hour of the PERIODIC polls for one repository (CI polled at the active
 * rate all hour, jobs for the maximum number of runs). Event-driven work comes on top, but only
 * within its share of the budget.
 */
export function estimatePeriodicRequestsPerHour(intervals: PollIntervals): number {
  const perHour = (ms: number) => Math.ceil((60 * MINUTE) / ms);
  const ci = perHour(intervals.ciActiveMs) * (1 + (intervals.fetchJobs ? MAX_JOB_FETCHES_PER_POLL : 0));
  return ci + perHour(intervals.commitsMs) + perHour(intervals.pullsMs);
}
