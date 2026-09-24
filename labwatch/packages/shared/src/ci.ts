/** CI state of a commit, used for tab dots: green / red / yellow / grey. */
export type CiState = 'success' | 'failure' | 'running' | 'none';

export interface RunLike {
  workflowName: string;
  runNumber: number;
  runAttempt: number;
  status: string;
  conclusion: string | null;
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Newest attempt of each workflow (a re-run replaces the previous attempt). */
export function latestPerWorkflow<T extends RunLike>(runs: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const run of runs) {
    const current = latest.get(run.workflowName);
    if (
      !current ||
      run.runNumber > current.runNumber ||
      (run.runNumber === current.runNumber && run.runAttempt > current.runAttempt)
    ) {
      latest.set(run.workflowName, run);
    }
  }
  return [...latest.values()];
}

/**
 * Combined state of the runs for one commit: any failure → failure (red wins), otherwise anything
 * still going → running, otherwise at least one success → success. Cancelled/skipped runs alone → none.
 */
export function ciStateOf(runs: readonly RunLike[]): CiState {
  const latest = latestPerWorkflow(runs);
  if (latest.some((r) => r.status === 'completed' && r.conclusion !== null && FAILED.has(r.conclusion))) return 'failure';
  if (latest.some((r) => r.status !== 'completed')) return 'running';
  if (latest.some((r) => r.conclusion === 'success')) return 'success';
  return 'none';
}
