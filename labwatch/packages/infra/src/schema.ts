import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

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
  },
  (t) => [index('ci_jobs_run_idx').on(t.runId)],
);

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
    baseRef: text('base_ref').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    htmlUrl: text('html_url').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number] })],
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
