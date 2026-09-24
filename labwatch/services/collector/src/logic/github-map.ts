import { areasForPaths, labNumberFromDir, type Branch, type CiJob, type CiRun, type CiStep, type Commit, type CompareInfo, type PrComment, type PrReview, type PullRequest } from '@labwatch/shared';

// Only the fields we use from GitHub REST responses.

export interface RawRun {
  id: number;
  name: string | null;
  run_number: number;
  run_attempt?: number;
  head_branch: string | null;
  head_sha: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  display_title?: string;
  actor?: { login: string } | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
}

export interface RawRunsPage {
  workflow_runs: RawRun[];
}

export interface RawStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface RawJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  steps?: RawStep[];
}

export interface RawJobsPage {
  jobs: RawJob[];
}

export interface RawBranch {
  name: string;
  commit: { sha: string };
  protected?: boolean;
}

export interface RawCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer: { date?: string } | null;
    verification?: { verified: boolean } | null;
  };
  author: { login: string } | null;
}

export interface RawPull {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at: string | null;
  user: { login: string } | null;
  head: { ref: string; sha?: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  html_url: string;
}

export function mapRun(repo: string, raw: RawRun): CiRun {
  return {
    id: raw.id,
    repo,
    workflowName: raw.name ?? 'workflow',
    runNumber: raw.run_number,
    runAttempt: raw.run_attempt ?? 1,
    branch: raw.head_branch,
    headSha: raw.head_sha,
    event: raw.event,
    status: raw.status ?? 'unknown',
    conclusion: raw.conclusion,
    title: raw.display_title ?? raw.name ?? '',
    actor: raw.actor?.login ?? null,
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    runStartedAt: raw.run_started_at ?? null,
  };
}

export function mapJob(raw: RawJob): CiJob {
  return {
    id: raw.id,
    runId: raw.run_id,
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    htmlUrl: raw.html_url,
    steps: (raw.steps ?? []).map(mapStep),
  };
}

export function mapStep(raw: RawStep): CiStep {
  return {
    number: raw.number,
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion,
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
  };
}

export function mapBranch(repo: string, raw: RawBranch): Branch {
  return { repo, name: raw.name, headSha: raw.commit.sha, protected: raw.protected ?? false };
}

export function mapCommit(repo: string, raw: RawCommit): Commit {
  return {
    sha: raw.sha,
    repo,
    message: raw.commit.message,
    authorName: raw.commit.author?.name ?? null,
    authorLogin: raw.author?.login ?? null,
    committedAt: raw.commit.committer?.date ?? raw.commit.author?.date ?? new Date(0).toISOString(),
    htmlUrl: raw.html_url,
    verified: raw.commit.verification?.verified ?? false,
  };
}

export function mapPull(repo: string, raw: RawPull): PullRequest {
  return {
    repo,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    draft: raw.draft ?? false,
    merged: raw.merged_at !== null,
    author: raw.user?.login ?? null,
    headRef: raw.head.ref,
    headSha: raw.head.sha ?? null,
    baseRef: raw.base.ref,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    htmlUrl: raw.html_url,
  };
}

/** Follow the default branch first, then the most recently updated ones, up to the limit. */
export function pickBranches(branches: Branch[], defaultBranch: string, limit: number): Branch[] {
  const sorted = [...branches].sort((a, b) => {
    if (a.name === defaultBranch) return -1;
    if (b.name === defaultBranch) return 1;
    return a.name.localeCompare(b.name);
  });
  return sorted.slice(0, limit);
}

export interface RawCompare {
  status: string;
  ahead_by: number;
  behind_by: number;
  commits?: Array<{ sha: string }>;
  files?: Array<{ filename: string }>;
}

export function mapCompare(base: string, baseSha: string, head: string, headSha: string, raw: RawCompare, now: Date): CompareInfo {
  const files = (raw.files ?? []).map((f) => f.filename);
  return {
    base,
    head,
    baseSha,
    headSha,
    status: raw.status,
    aheadBy: raw.ahead_by,
    behindBy: raw.behind_by,
    aheadShas: (raw.commits ?? []).map((c) => c.sha),
    areas: areasForPaths(files),
    fileCount: files.length,
    fetchedAt: now.toISOString(),
  };
}

export interface RawCommitDetail {
  sha: string;
  files?: Array<{ filename: string; status?: string }>;
}

/** The API lists at most 300 files per commit. */
export const MAX_COMMIT_FILES = 300;

export function mapCommitFiles(raw: RawCommitDetail): { files: Array<{ path: string; status: string | null }>; truncated: boolean } {
  const files = (raw.files ?? []).map((f) => ({ path: f.filename, status: f.status ?? null }));
  return { files, truncated: files.length >= MAX_COMMIT_FILES };
}

export interface RawTree {
  tree: Array<{ path: string; type: string }>;
}

/** Lab numbers from the top-level Lab<N>/ directories. */
export function labsFromTree(raw: RawTree): number[] {
  return raw.tree
    .filter((e) => e.type === 'tree')
    .map((e) => labNumberFromDir(e.path))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

export interface RawReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  submitted_at?: string | null;
  html_url?: string | null;
}

export function mapReview(raw: RawReview): PrReview {
  return {
    id: raw.id,
    author: raw.user?.login ?? null,
    state: raw.state,
    body: raw.body ?? '',
    submittedAt: raw.submitted_at ?? null,
    htmlUrl: raw.html_url ?? null,
  };
}

export interface RawComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  in_reply_to_id?: number;
}

export function mapComment(raw: RawComment, kind: 'inline' | 'issue'): PrComment {
  return {
    id: raw.id,
    kind,
    author: raw.user?.login ?? null,
    path: raw.path ?? null,
    // line is null when the commented line is gone from the latest diff; keep the original then
    line: raw.line ?? raw.original_line ?? null,
    body: raw.body ?? '',
    createdAt: raw.created_at,
    htmlUrl: raw.html_url,
    inReplyToId: raw.in_reply_to_id ?? null,
  };
}

export interface RawCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  completed_at: string | null;
  output: { title: string | null; summary: string | null; annotations_count: number };
}

export interface RawCheckRunsPage {
  total_count: number;
  check_runs: RawCheckRun[];
}
