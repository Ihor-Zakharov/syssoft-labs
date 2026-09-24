import {
  areasForPaths,
  ciStateOf,
  countFindings,
  latestPerWorkflow,
  reviewRunOutcome,
  type BranchState,
  type BranchSummary,
  type CiRun,
  type CommitsStatus,
  type PrCheck,
  type PullRequest,
  type ReviewPostLike,
  type ReviewRunOutcome,
} from '@labwatch/shared';

// Pure view-building helpers: the gateway queries, these decide.

/** The PR shown for a branch: its open PR, else the most recently updated one. */
export function prForBranch<T extends Pick<PullRequest, 'headRef' | 'state' | 'updatedAt'>>(pulls: readonly T[], branch: string): T | null {
  const mine = pulls.filter((p) => p.headRef === branch).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return mine.find((p) => p.state === 'open') ?? mine[0] ?? null;
}

function latest(...dates: Array<string | null | undefined>): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  return valid.length === 0 ? null : valid.reduce((a, b) => (a > b ? a : b));
}

export interface BranchInputs {
  status: CommitsStatus;
  /** Runs whose head SHA is the head of some branch. */
  headRuns: readonly CiRun[];
  /** Latest run update per branch name. */
  lastRunAt: ReadonlyMap<string, string>;
  pulls: readonly PullRequest[];
  findingsByPr: ReadonlyMap<number, number>;
}

/**
 * Tab data for every branch. Merged: its PR was merged (and none is open), or it has nothing that
 * the default branch lacks (ahead by 0).
 */
export function branchSummaries(input: BranchInputs): BranchSummary[] {
  return input.status.branches.map((branch) => {
    const isDefault = branch.name === input.status.defaultBranch;
    const pr = prForBranch(input.pulls, branch.name);
    const head = branch.commits.find((c) => c.sha === branch.headSha);
    const compare = compareFor(branch);
    const merged = !isDefault && ((pr !== null && pr.merged && pr.state !== 'open') || compare?.aheadBy === 0);
    return {
      name: branch.name,
      isDefault,
      headSha: branch.headSha,
      lastActivityAt: latest(head?.committedAt, input.lastRunAt.get(branch.name), pr?.updatedAt),
      merged,
      ciState: ciStateOf(input.headRuns.filter((r) => r.headSha === branch.headSha)),
      aheadBy: compare?.aheadBy ?? null,
      behindBy: compare?.behindBy ?? null,
      pr: pr ? { number: pr.number, state: pr.state, draft: pr.draft, merged: pr.merged, htmlUrl: pr.htmlUrl } : null,
      findings: pr ? (input.findingsByPr.get(pr.number) ?? 0) : 0,
    };
  });
}

/** The branch's compare with the default branch, if it describes the current head. */
export function compareFor(branch: BranchState) {
  return branch.compare && branch.compare.headSha === branch.headSha ? branch.compare : null;
}

/**
 * Is the commit on the default branch? False when some branch's compare lists it as ahead,
 * true when it was seen on the default branch, otherwise unknown.
 */
export function inMain(sha: string, seenOn: readonly string[], defaultBranch: string, aheadOfMain: ReadonlySet<string>): boolean | null {
  if (aheadOfMain.has(sha)) return false;
  if (seenOn.includes(defaultBranch)) return true;
  return null;
}

/** Commit SHAs that some branch has and the default branch lacks (from current compares). */
export function aheadOfMain(status: CommitsStatus | null): Set<string> {
  const shas = new Set<string>();
  for (const branch of status?.branches ?? []) {
    const compare = compareFor(branch);
    compare?.aheadShas.forEach((s) => shas.add(s));
  }
  return shas;
}

/** Areas from a commit's file paths; null while its files are not fetched yet. */
export function commitAreas(paths: readonly string[] | undefined): string[] | null {
  return paths === undefined ? null : areasForPaths(paths);
}

/** Latest run of each workflow for a commit, as PR "checks". */
export function checksFor(runs: readonly CiRun[]): PrCheck[] {
  return latestPerWorkflow(runs)
    .sort((a, b) => a.workflowName.localeCompare(b.workflowName))
    .map((r) => ({ workflowName: r.workflowName, status: r.status, conclusion: r.conclusion, htmlUrl: r.htmlUrl }));
}

export interface PrPosts {
  author: string | null;
  posts: ReviewPostLike[];
  inline: Array<{ author: string | null; inReplyToId: number | null; createdAt: string }>;
}

export function findingsOf(pr: PrPosts): number {
  return countFindings(pr.inline, pr.author);
}

/** Outcome of an agentic review run, judged by what was posted on its PR during the run. */
export function reviewOutcomeFor(run: CiRun, pr: PrPosts | null): ReviewRunOutcome {
  return reviewRunOutcome(run, pr?.posts ?? [], pr?.author ?? null);
}
