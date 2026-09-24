import { z } from 'zod';

// All timestamps are ISO-8601 strings: they cross JSON boundaries (Redis, tRPC) unchanged.
const iso = z.string();

export const CiRunSchema = z.object({
  id: z.number(),
  repo: z.string(),
  workflowName: z.string(),
  runNumber: z.number(),
  runAttempt: z.number(),
  branch: z.string().nullable(),
  headSha: z.string(),
  event: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  title: z.string(),
  actor: z.string().nullable(),
  htmlUrl: z.string(),
  createdAt: iso,
  updatedAt: iso,
  runStartedAt: iso.nullable(),
});
export type CiRun = z.infer<typeof CiRunSchema>;

export const CiJobSchema = z.object({
  id: z.number(),
  runId: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  startedAt: iso.nullable(),
  completedAt: iso.nullable(),
  htmlUrl: z.string().nullable(),
});
export type CiJob = z.infer<typeof CiJobSchema>;

export const CiStatusSchema = z.object({
  repo: z.string(),
  updatedAt: iso,
  activeRuns: z.number(),
  runs: z.array(CiRunSchema),
  /** Jobs of the currently active runs, by run id (only fetched with a GitHub token). */
  jobs: z.record(z.string(), z.array(CiJobSchema)),
});
export type CiStatus = z.infer<typeof CiStatusSchema>;

export const CommitSchema = z.object({
  sha: z.string(),
  repo: z.string(),
  message: z.string(),
  authorName: z.string().nullable(),
  authorLogin: z.string().nullable(),
  committedAt: iso,
  htmlUrl: z.string(),
  verified: z.boolean(),
});
export type Commit = z.infer<typeof CommitSchema>;

export const BranchSchema = z.object({
  repo: z.string(),
  name: z.string(),
  headSha: z.string(),
  protected: z.boolean(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const CommitsStatusSchema = z.object({
  repo: z.string(),
  updatedAt: iso,
  branches: z.array(BranchSchema),
  commits: z.array(CommitSchema),
});
export type CommitsStatus = z.infer<typeof CommitsStatusSchema>;

export const PullRequestSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  merged: z.boolean(),
  author: z.string().nullable(),
  headRef: z.string(),
  baseRef: z.string(),
  createdAt: iso,
  updatedAt: iso,
  htmlUrl: z.string(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PullsStatusSchema = z.object({
  repo: z.string(),
  updatedAt: iso,
  pulls: z.array(PullRequestSchema),
});
export type PullsStatus = z.infer<typeof PullsStatusSchema>;

export const SourceProbeSchema = z.object({
  url: z.string(),
  checkedAt: iso,
  /** Reachable, HTTP 200 and the certificate is the pinned one. */
  ok: z.boolean(),
  httpStatus: z.number().nullable(),
  latencyMs: z.number().nullable(),
  bodySha256: z.string().nullable(),
  bodyBytes: z.number().nullable(),
  certSha256: z.string().nullable(),
  certSubject: z.string().nullable(),
  certValidTo: iso.nullable(),
  /** Why standard TLS validation fails (expected: the cert is expired and issued for another name). */
  tlsError: z.string().nullable(),
  error: z.string().nullable(),
});
export type SourceProbe = z.infer<typeof SourceProbeSchema>;

export const SourceStatusSchema = SourceProbeSchema.extend({
  expectedCertSha256: z.string(),
  expectedBodySha256: z.string().nullable(),
  certPinned: z.boolean(),
  bodyMatches: z.boolean().nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const RateLimitSchema = z.object({
  authenticated: z.boolean(),
  limit: z.number(),
  remaining: z.number(),
  /** When the window resets (ISO). */
  resetAt: iso,
  observedAt: iso,
});
export type RateLimit = z.infer<typeof RateLimitSchema>;

export const HeartbeatSchema = z.object({
  service: z.string(),
  at: iso,
  pid: z.number(),
  version: z.string(),
  startedAt: iso,
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const EVENT_KINDS = [
  'ci.failed',
  'ci.recovered',
  'source.down',
  'source.up',
  'source.body_changed',
  'source.cert_changed',
  'service.down',
  'service.up',
] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

export const SeveritySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof SeveritySchema>;

export const LabEventSchema = z.object({
  kind: EventKindSchema,
  severity: SeveritySchema,
  title: z.string(),
  at: iso,
  data: z.record(z.string(), z.unknown()),
});
export type LabEvent = z.infer<typeof LabEventSchema>;

/** An event as read back from the feed, with its stream id. */
export const StoredEventSchema = LabEventSchema.extend({ id: z.string() });
export type StoredEvent = z.infer<typeof StoredEventSchema>;

export const UPDATE_TOPICS = ['ci', 'commits', 'pulls', 'source', 'health', 'events', 'ratelimit'] as const;
export const UpdateTopicSchema = z.enum(UPDATE_TOPICS);
export type UpdateTopic = z.infer<typeof UpdateTopicSchema>;

/** Message on the pub/sub channel: tells UIs which part of the dashboard to refresh. */
export const UpdateMessageSchema = z.object({
  topic: UpdateTopicSchema,
  at: iso,
});
export type UpdateMessage = z.infer<typeof UpdateMessageSchema>;
