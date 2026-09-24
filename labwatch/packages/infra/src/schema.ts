import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { CiStep, TestAnnotation, TestReportFile } from '@labwatch/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Every GitHub Actions run ever seen (upserted: a run changes status until it completes). */
export const ciRuns = pgTable(
  'ci_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    repo: text('repo').notNull(),
    workflowName: text('workflow_name').notNull(),
    runNumber: integer('run_number').notNull(),
    runAttempt: integer('run_attempt').notNull(),
    branch: text('branch'),
    headSha: text('head_sha').notNull(),
    event: text('event').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion'),
    title: text('title').notNull(),
    actor: text('actor'),
    htmlUrl: text('html_url').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    runStartedAt: ts('run_started_at'),
  },
  (t) => [index('ci_runs_repo_created_idx').on(t.repo, t.createdAt)],
);

export const ciJobs = pgTable(
  'ci_jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    runId: bigint('run_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    htmlUrl: text('html_url'),
    steps: jsonb('steps').$type<CiStep[]>().notNull().default([]),
  },
  (t) => [index('ci_jobs_run_idx').on(t.runId)],
);

/** Runs whose final jobs (with steps) were fetched after completion: never fetched again. */
export const ciJobsFetched = pgTable('ci_jobs_fetched', {
  runId: bigint('run_id', { mode: 'number' }).primaryKey(),
  fetchedAt: ts('fetched_at').notNull(),
});

export const commits = pgTable(
  'commits',
  {
    sha: text('sha').primaryKey(),
    repo: text('repo').notNull(),
    message: text('message').notNull(),
    authorName: text('author_name'),
    authorLogin: text('author_login'),
    committedAt: ts('committed_at').notNull(),
    htmlUrl: text('html_url').notNull(),
    verified: boolean('verified').notNull(),
  },
  (t) => [index('commits_repo_committed_idx').on(t.repo, t.committedAt)],
);

export const branches = pgTable(
  'branches',
  {
    repo: text('repo').notNull(),
    name: text('name').notNull(),
    headSha: text('head_sha').notNull(),
    protected: boolean('protected').notNull(),
    seenAt: ts('seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.name] })],
);

export const pullRequests = pgTable(
  'pull_requests',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    draft: boolean('draft').notNull(),
    merged: boolean('merged').notNull(),
    author: text('author'),
    headRef: text('head_ref').notNull(),
    headSha: text('head_sha'),
    baseRef: text('base_ref').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    htmlUrl: text('html_url').notNull(),
    // Filled by the sync service, never by the list poll (excluded from its upsert)
    reviewState: text('review_state'),
    /** PR updated_at for which reviews and comments were fetched. */
    reviewedAt: ts('reviewed_at'),
    areas: text('areas').array(),
    areasHeadSha: text('areas_head_sha'),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number] })],
);

export const prReviews = pgTable(
  'pr_reviews',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    author: text('author'),
    state: text('state').notNull(),
    body: text('body').notNull(),
    submittedAt: ts('submitted_at'),
    htmlUrl: text('html_url'),
  },
  (t) => [index('pr_reviews_pr_idx').on(t.repo, t.number)],
);

/** Inline review comments (path + line) and conversation comments of pull requests. */
export const prComments = pgTable(
  'pr_comments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    author: text('author'),
    path: text('path'),
    line: integer('line'),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    htmlUrl: text('html_url').notNull(),
    inReplyToId: bigint('in_reply_to_id', { mode: 'number' }),
  },
  (t) => [index('pr_comments_pr_idx').on(t.repo, t.number)],
);

/** Which branches a commit was seen on (the change feed and "not in main" marks). */
export const branchCommits = pgTable(
  'branch_commits',
  {
    repo: text('repo').notNull(),
    branch: text('branch').notNull(),
    sha: text('sha').notNull(),
    seenAt: ts('seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.branch, t.sha] }), index('branch_commits_sha_idx').on(t.sha)],
);

/** Changed files of a commit. Commits are immutable, so each SHA is fetched once and kept forever. */
export const commitFiles = pgTable(
  'commit_files',
  {
    sha: text('sha').notNull(),
    path: text('path').notNull(),
    status: text('status'),
  },
  (t) => [primaryKey({ columns: [t.sha, t.path] }), index('commit_files_path_idx').on(t.path)],
);

/** Marks a commit whose files were fetched (a commit may change no files, so commit_files alone is not enough). */
export const commitDetails = pgTable('commit_details', {
  sha: text('sha').primaryKey(),
  repo: text('repo').notNull(),
  fetchedAt: ts('fetched_at').notNull(),
  fileCount: integer('file_count').notNull(),
  /** The API lists at most 300 files per commit. */
  truncated: boolean('truncated').notNull(),
});

/** Test-report check runs (e.g. dorny/test-reporter) with the parsed summary. */
export const testReports = pgTable(
  'test_reports',
  {
    checkRunId: bigint('check_run_id', { mode: 'number' }).primaryKey(),
    repo: text('repo').notNull(),
    headSha: text('head_sha').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion'),
    htmlUrl: text('html_url'),
    completedAt: ts('completed_at'),
    title: text('title'),
    parsed: boolean('parsed').notNull(),
    total: integer('total').notNull(),
    passed: integer('passed').notNull(),
    failed: integer('failed').notNull(),
    skipped: integer('skipped').notNull(),
    files: jsonb('files').$type<TestReportFile[]>().notNull(),
    annotations: jsonb('annotations').$type<TestAnnotation[]>().notNull(),
  },
  (t) => [index('test_reports_sha_idx').on(t.headSha)],
);

/** Commits whose check runs were read; `complete` = every check run had finished (no need to look again). */
export const checkRunsFetched = pgTable(
  'check_runs_fetched',
  {
    repo: text('repo').notNull(),
    headSha: text('head_sha').notNull(),
    fetchedAt: ts('fetched_at').notNull(),
    complete: boolean('complete').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.headSha] })],
);

/** Every status-page check (one per target per minute per vantage: ~520k rows in 90 days). */
export const statusChecks = pgTable(
  'status_checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    target: text('target').notNull(),
    vantage: text('vantage').notNull(),
    checkedAt: ts('checked_at').notNull(),
    /** operational | degraded | down */
    outcome: text('outcome').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    tlsOk: boolean('tls_ok'),
    tlsError: text('tls_error'),
    error: text('error'),
  },
  (t) => [
    index('status_checks_target_idx').on(t.target, t.vantage, t.checkedAt),
    // Append-only time series: a BRIN index is tiny and makes retention deletes cheap
    index('status_checks_checked_brin').using('brin', t.checkedAt),
  ],
);

export const statusIncidents = pgTable(
  'status_incidents',
  {
    id: serial('id').primaryKey(),
    target: text('target').notNull(),
    vantage: text('vantage').notNull(),
    startedAt: ts('started_at').notNull(),
    resolvedAt: ts('resolved_at'),
    failedChecks: integer('failed_checks').notNull().default(1),
    lastError: text('last_error'),
  },
  (t) => [
    index('status_incidents_started_idx').on(t.startedAt),
    // At most one open incident per target and vantage
    uniqueIndex('status_incidents_open_idx').on(t.target, t.vantage).where(sql`${t.resolvedAt} is null`),
  ],
);

/** One row per probe of the lab source file (manual.txt). */
export const sourceProbes = pgTable(
  'source_probes',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull(),
    checkedAt: ts('checked_at').notNull(),
    ok: boolean('ok').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    bodySha256: text('body_sha256'),
    bodyBytes: integer('body_bytes'),
    certSha256: text('cert_sha256'),
    certSubject: text('cert_subject'),
    certValidTo: ts('cert_valid_to'),
    tlsError: text('tls_error'),
    error: text('error'),
  },
  (t) => [index('source_probes_checked_idx').on(t.checkedAt)],
);

/** Durable copy of the event feed (the Redis stream is capped). */
export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    at: ts('at').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('events_at_idx').on(t.at)],
);
