import type { CiState } from './ci.js';
import type { Overall } from './overall.js';
import type { ReviewRunOutcome, ReviewState } from './reviews.js';
import type { CiJob, CiRun, Commit, CompareInfo, PullRequest, SourceStatus, StatusCheck } from './schemas.js';
import type { StatusLevel, StatusOutcome, StatusScale } from './status.js';
import type { BranchTabInfo } from './tabs.js';

/** A service or a store in the summary strip. */
export interface ServiceHealth {
  name: string;
  kind: 'service' | 'store';
  up: boolean;
  /** Last heartbeat (services) or the time of the ping (stores). */
  lastSeen: string | null;
  latencyMs: number | null;
  version: string | null;
  detail: string | null;
}

/** GitHub requests made by labwatch in the last rolling hour vs its own budget. */
export interface ApiUsage {
  authenticated: boolean;
  tokenRejected: boolean;
  used: number;
  budgetPerHour: number;
  /** What GitHub itself reports for this token / IP. */
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
}

export interface Overview {
  generatedAt: string;
  repos: string[];
  defaultBranch: string;
  services: ServiceHealth[];
  source: SourceStatus | null;
  api: ApiUsage | null;
  statusLevel: StatusLevel;
  mainCi: CiState;
  overall: Overall;
}

export interface BranchSummary extends BranchTabInfo {
  headSha: string;
  aheadBy: number | null;
  behindBy: number | null;
  pr: { number: number; state: string; draft: boolean; merged: boolean; htmlUrl: string } | null;
  /** Review findings on the branch's PR. */
  findings: number;
}

export interface BranchesView {
  defaultBranch: string;
  labs: number[];
  branches: BranchSummary[];
}

// CI

export interface TestSuiteSummary {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  time: string | null;
}

/** One report file (usually one test assembly), with its suites. */
export interface TestReportFile {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  time: string | null;
  suites: TestSuiteSummary[];
}

export interface TestAnnotation {
  path: string;
  startLine: number | null;
  level: string;
  title: string | null;
  message: string;
}

export interface TestTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** A test-report check run (e.g. from dorny/test-reporter) for a commit. */
export interface TestReport extends TestTotals {
  checkRunId: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string | null;
  headSha: string;
  completedAt: string | null;
  /** False when the summary could not be parsed: show title and link only. */
  parsed: boolean;
  title: string | null;
  files: TestReportFile[];
  annotations: TestAnnotation[];
}

export interface CiRunRow extends CiRun {
  jobs: CiJob[];
  /** For agentic review runs: what the run posted on its PR. */
  review: ReviewRunOutcome | null;
  /** Test totals of the commit (from its test-report check run), if any. */
  tests: TestTotals | null;
}

export interface CiRunDetail {
  run: CiRunRow;
  testReports: TestReport[];
  pr: { number: number; htmlUrl: string } | null;
}

// Commits

export interface CommitRow extends Commit {
  /** Branches this commit was seen on. */
  branches: string[];
  /** Areas from the changed file paths; null while the commit's files are not fetched yet. */
  areas: string[] | null;
  /** Whether the commit is already on the default branch; null when unknown. */
  inMain: boolean | null;
}

export interface CommitsView {
  branch: string | null;
  defaultBranch: string;
  compare: CompareInfo | null;
  labs: number[];
  commits: CommitRow[];
}

// Pull requests

export interface PrCheck {
  workflowName: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
}

export interface PullRow extends PullRequest {
  reviewState: ReviewState;
  findings: number;
  areas: string[] | null;
  checks: PrCheck[];
  ciState: CiState;
  /** Outcome of the latest agentic review run for this PR. */
  lastReview: ReviewRunOutcome | null;
}

export interface PrReview {
  id: number;
  author: string | null;
  state: string;
  body: string;
  submittedAt: string | null;
  htmlUrl: string | null;
}

export interface PrComment {
  id: number;
  kind: 'inline' | 'issue';
  author: string | null;
  path: string | null;
  line: number | null;
  body: string;
  createdAt: string;
  htmlUrl: string;
  inReplyToId: number | null;
}

export interface PullDetail {
  pull: PullRow;
  reviews: PrReview[];
  comments: PrComment[];
}

// Status page

export interface UptimeBucket {
  start: string;
  end: string;
  total: number;
  up: number;
  degraded: number;
  down: number;
  uptime: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface StatusTargetView {
  id: string;
  name: string;
  url: string;
  group: string;
  current: StatusCheck | null;
  state: StatusOutcome | 'no_data';
  /** Uptime over the selected scale. */
  uptime: number | null;
  buckets: UptimeBucket[];
}

export interface StatusPageView {
  generatedAt: string;
  vantage: string;
  vantages: string[];
  scale: StatusScale;
  timezone: string;
  level: StatusLevel;
  groups: Array<{ name: string; targets: StatusTargetView[] }>;
}

export interface StatusIncident {
  id: number;
  target: string;
  targetName: string;
  vantage: string;
  startedAt: string;
  resolvedAt: string | null;
  durationS: number;
  failedChecks: number;
  lastError: string | null;
}
