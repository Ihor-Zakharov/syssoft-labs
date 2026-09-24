import type { Branch, CiJob, CiRun, Commit, PullRequest, SourceStatus } from '@labwatch/shared';
import type { branches, ciJobs, ciRuns, commits, pullRequests, sourceProbes } from '@labwatch/infra';

// API shapes use ISO strings; the database stores real timestamps.

const date = (iso: string) => new Date(iso);
const dateOrNull = (iso: string | null) => (iso === null ? null : new Date(iso));

export function runRow(run: CiRun): typeof ciRuns.$inferInsert {
  return {
    ...run,
    createdAt: date(run.createdAt),
    updatedAt: date(run.updatedAt),
    runStartedAt: dateOrNull(run.runStartedAt),
  };
}

export function jobRow(job: CiJob): typeof ciJobs.$inferInsert {
  return { ...job, startedAt: dateOrNull(job.startedAt), completedAt: dateOrNull(job.completedAt) };
}

export function commitRow(commit: Commit): typeof commits.$inferInsert {
  return { ...commit, committedAt: date(commit.committedAt) };
}

export function branchRow(branch: Branch, seenAt: Date): typeof branches.$inferInsert {
  return { ...branch, seenAt };
}

export function pullRow(pull: PullRequest): typeof pullRequests.$inferInsert {
  return { ...pull, createdAt: date(pull.createdAt), updatedAt: date(pull.updatedAt) };
}

export function probeRow(status: SourceStatus): typeof sourceProbes.$inferInsert {
  return {
    url: status.url,
    checkedAt: date(status.checkedAt),
    ok: status.ok,
    httpStatus: status.httpStatus,
    latencyMs: status.latencyMs,
    bodySha256: status.bodySha256,
    bodyBytes: status.bodyBytes,
    certSha256: status.certSha256,
    certSubject: status.certSubject,
    certValidTo: dateOrNull(status.certValidTo),
    tlsError: status.tlsError,
    error: status.error,
  };
}
