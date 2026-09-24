/**
 * How often each source is polled. With a token GitHub allows 5000 requests/hour and conditional
 * requests answered with 304 are free, so we can poll often. Without a token the limit is 60/hour
 * and 304s DO count, so intervals are stretched to stay under that budget (see estimateRequestsPerHour).
 */
export interface PollIntervals {
  /** CI while some run is queued or in progress: watch it live. */
  ciActiveMs: number;
  ciIdleMs: number;
  commitsMs: number;
  pullsMs: number;
  /** The university server hosting manual.txt: be polite regardless of auth. */
  sourceMs: number;
  /** How many branches to follow commits for. */
  maxBranches: number;
  /** Whether to fetch per-job details of active runs (costs one request per run). */
  fetchJobs: boolean;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const AUTHENTICATED_INTERVALS: PollIntervals = {
  ciActiveMs: 30 * SECOND,
  ciIdleMs: 2 * MINUTE,
  commitsMs: 1 * MINUTE,
  pullsMs: 2 * MINUTE,
  sourceMs: 5 * MINUTE,
  maxBranches: 10,
  fetchJobs: true,
};

export const UNAUTHENTICATED_INTERVALS: PollIntervals = {
  ciActiveMs: 5 * MINUTE,
  ciIdleMs: 10 * MINUTE,
  commitsMs: 15 * MINUTE,
  pullsMs: 20 * MINUTE,
  sourceMs: 5 * MINUTE,
  maxBranches: 5,
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
 * Worst-case GitHub requests per hour for one repository: CI polled at the active rate all hour,
 * jobs fetched for the maximum number of runs, every followed branch polled for commits.
 */
export function estimateRequestsPerHour(intervals: PollIntervals): number {
  const perHour = (ms: number) => Math.ceil((60 * MINUTE) / ms);
  const ci = perHour(intervals.ciActiveMs) * (1 + (intervals.fetchJobs ? MAX_JOB_FETCHES_PER_POLL : 0));
  const commits = perHour(intervals.commitsMs) * (1 + intervals.maxBranches);
  const pulls = perHour(intervals.pullsMs);
  return ci + commits + pulls;
}

/**
 * If the remaining quota is at or below the reserve, wait until the window resets (plus a second of
 * slack for clock skew). Returns 0 when requests may go ahead now.
 */
export function rateLimitDelay(
  rate: { remaining: number; resetAt: string } | null,
  now: Date,
  reserve = 5,
): number {
  if (!rate || rate.remaining > reserve) return 0;
  const untilReset = new Date(rate.resetAt).getTime() - now.getTime();
  return Math.max(untilReset + SECOND, 0);
}
