import type { CiRun, LabEvent } from '@labwatch/shared';

/** Last meaningful conclusion per "workflow@branch". */
export type CiState = Record<string, string>;

const BAD = new Set(['failure', 'timed_out', 'startup_failure']);
const GOOD = new Set(['success']);

export function ciKey(run: Pick<CiRun, 'workflowName' | 'branch'>): string {
  return `${run.workflowName}@${run.branch ?? '-'}`;
}

/** Latest completed run per workflow+branch that ended with success or failure (cancelled/skipped runs say nothing about health). */
export function latestMeaningful(runs: readonly CiRun[]): Map<string, CiRun> {
  const latest = new Map<string, CiRun>();
  for (const run of runs) {
    if (run.status !== 'completed' || !run.conclusion) continue;
    if (!BAD.has(run.conclusion) && !GOOD.has(run.conclusion)) continue;
    const key = ciKey(run);
    const current = latest.get(key);
    if (!current || isNewer(run, current)) latest.set(key, run);
  }
  return latest;
}

function isNewer(a: CiRun, b: CiRun): boolean {
  if (a.runNumber !== b.runNumber) return a.runNumber > b.runNumber;
  if (a.runAttempt !== b.runAttempt) return a.runAttempt > b.runAttempt;
  return a.updatedAt > b.updatedAt;
}

/**
 * Compares the newest conclusions with the previous state and produces events only on transitions:
 * green→red (or a brand-new workflow/branch that fails) and red→green. With no previous state
 * (first start, Redis wiped) the state is seeded silently, so a restart never floods the feed.
 */
export function diffCi(prev: CiState | null, runs: readonly CiRun[], now: Date): { next: CiState; events: LabEvent[] } {
  const next: CiState = { ...(prev ?? {}) };
  const events: LabEvent[] = [];

  for (const [key, run] of latestMeaningful(runs)) {
    const before = prev?.[key];
    const after = run.conclusion!;
    next[key] = after;
    if (prev === null) continue;

    const data = {
      repo: run.repo,
      workflow: run.workflowName,
      branch: run.branch,
      runId: run.id,
      runNumber: run.runNumber,
      sha: run.headSha,
      url: run.htmlUrl,
      conclusion: after,
      previous: before ?? null,
    };
    if (BAD.has(after) && (before === undefined || !BAD.has(before))) {
      events.push({
        kind: 'ci.failed',
        severity: 'error',
        title: `${run.workflowName} failed on ${run.branch ?? 'unknown branch'} (#${run.runNumber})`,
        at: now.toISOString(),
        data,
      });
    } else if (GOOD.has(after) && before !== undefined && BAD.has(before)) {
      events.push({
        kind: 'ci.recovered',
        severity: 'info',
        title: `${run.workflowName} is green again on ${run.branch ?? 'unknown branch'} (#${run.runNumber})`,
        at: now.toISOString(),
        data,
      });
    }
  }

  return { next, events };
}
