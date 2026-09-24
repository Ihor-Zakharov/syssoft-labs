import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  RedisKeys,
  type ApiBudget,
  type Branch,
  type CiJob,
  type CiRun,
  type Commit,
  type CompareInfo,
  type PrComment,
  type PrReview,
  type PullRequest,
  type RateLimit,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, VERSION, type CollectorConfig } from '../config.js';
import { REDIS } from '../infra/tokens.js';
import { BudgetExceededError, HOUR_MS, RequestBudget, type Priority } from '../logic/budget.js';
import {
  EtagClient,
  GithubHttpError,
  type CachedResponse,
  type EtagCache,
  type FetchResult,
  type RateLimitInfo,
} from '../logic/etag-client.js';
import {
  labsFromTree,
  mapBranch,
  mapComment,
  mapCommit,
  mapCommitFiles,
  mapCompare,
  mapJob,
  mapPull,
  mapReview,
  mapRun,
  type RawBranch,
  type RawCheckRun,
  type RawCheckRunsPage,
  type RawComment,
  type RawCommit,
  type RawCommitDetail,
  type RawCompare,
  type RawJobsPage,
  type RawPull,
  type RawReview,
  type RawRunsPage,
  type RawTree,
} from '../logic/github-map.js';
import { intervalsFor, type PollIntervals } from '../logic/intervals.js';
import { mapAnnotation, type RawAnnotation } from '../logic/test-report.js';

/** ETags live a day: after that a full response is fetched again, which is fine. */
const ETAG_TTL_S = 24 * 60 * 60;

/**
 * All GitHub calls. Each one is tagged with a priority and must get a slot from the shared
 * rolling-hour budget first (see budget.ts); a denied call throws BudgetExceededError.
 */
@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private readonly cache: EtagCache;
  private client: EtagClient;
  private budgetImpl: RequestBudget;
  /** The configured token was rejected (401): running anonymously until the collector restarts with a new one. */
  private tokenRejected = false;

  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.cache = {
      get: async <T>(url: string) => {
        const raw = await redis.get(RedisKeys.etag(url));
        return raw === null ? null : (JSON.parse(raw) as CachedResponse<T>);
      },
      set: async <T>(url: string, value: CachedResponse<T>) => {
        await redis.set(RedisKeys.etag(url), JSON.stringify(value), 'EX', ETAG_TTL_S);
      },
    };
    this.client = this.createClient(config.githubToken);
    this.budgetImpl = this.createBudget();
    this.logger.log(
      this.client.authenticated
        ? `Using GITHUB_TOKEN: budget ${this.budgetImpl.budgetPerHour} requests/hour`
        : `No GITHUB_TOKEN: budget ${this.budgetImpl.budgetPerHour} of GitHub's 60 requests/hour, slow polling`,
    );
  }

  private createClient(token: string | undefined): EtagClient {
    return new EtagClient({ fetch: globalThis.fetch, cache: this.cache, token, userAgent: `labwatch-collector/${VERSION}` });
  }

  private createBudget(): RequestBudget {
    const budgetPerHour = this.client.authenticated ? this.config.authBudgetPerHour : this.config.unauthBudgetPerHour;
    return new RequestBudget({ budgetPerHour, onGrant: (at) => void this.persistGrant(at) });
  }

  /** The request budget of the current mode (token or anonymous). */
  get budget(): RequestBudget {
    return this.budgetImpl;
  }

  async onModuleInit(): Promise<void> {
    await this.loadWindow();
  }

  /** Continue the rolling window of the previous process: a restart must not reset the budget. */
  private async loadWindow(): Promise<void> {
    const key = RedisKeys.apiRequests(this.authenticated);
    const since = Date.now() - HOUR_MS;
    await this.redis.zremrangebyscore(key, '-inf', since);
    const stamps = await this.redis.zrangebyscore(key, since, '+inf', 'WITHSCORES');
    this.budgetImpl.seed(stamps.filter((_, i) => i % 2 === 1).map(Number));
    const budget: ApiBudget = {
      authenticated: this.authenticated,
      budgetPerHour: this.budgetImpl.budgetPerHour,
      windowMs: HOUR_MS,
      tokenRejected: this.tokenRejected,
    };
    await this.redis.set(RedisKeys.apiBudget, JSON.stringify(budget));
    this.logger.log(`GitHub requests in the last hour: ${this.budgetImpl.used()}/${this.budgetImpl.budgetPerHour}`);
  }

  get authenticated(): boolean {
    return this.client.authenticated;
  }

  get tokenConfigured(): boolean {
    return Boolean(this.config.githubToken);
  }

  get isTokenRejected(): boolean {
    return this.tokenRejected;
  }

  /**
   * A revoked or expired token must not stop the collector: continue anonymously with the
   * anonymous budget (and its own request window). The GitHub card shows "Auth error" meanwhile.
   */
  private async degradeToAnonymous(): Promise<void> {
    if (!this.authenticated) return;
    this.tokenRejected = true;
    this.client = this.createClient(undefined);
    this.budgetImpl = this.createBudget();
    this.logger.warn(`GitHub rejected the token (401): continuing without it, budget ${this.budgetImpl.budgetPerHour} requests/hour`);
    await this.loadWindow();
  }

  get intervals(): PollIntervals {
    return intervalsFor(this.authenticated);
  }

  /** Whether a call of this priority would be granted right now (no request is made). */
  canCall(priority: Priority): boolean {
    return this.budgetImpl.msUntilAvailable(priority) === 0;
  }

  // ci
  runs(repo: string): Promise<FetchResult<CiRun[]>> {
    return this.get('ci', `/repos/${repo}/actions/runs?per_page=30`, (raw: RawRunsPage) => raw.workflow_runs.map((r) => mapRun(repo, r)));
  }

  /** Jobs with their steps. Active runs are CI work; the final state of finished runs is backfill ("checks"). */
  jobs(repo: string, runId: number, priority: Priority = 'ci'): Promise<FetchResult<CiJob[]>> {
    return this.get(priority, `/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, (raw: RawJobsPage) => raw.jobs.map(mapJob));
  }

  // reviews
  pulls(repo: string): Promise<FetchResult<PullRequest[]>> {
    return this.get('reviews', `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`, (raw: RawPull[]) =>
      raw.map((p) => mapPull(repo, p)),
    );
  }

  reviews(repo: string, number: number): Promise<FetchResult<PrReview[]>> {
    return this.get('reviews', `/repos/${repo}/pulls/${number}/reviews?per_page=100`, (raw: RawReview[]) => raw.map(mapReview));
  }

  reviewComments(repo: string, number: number): Promise<FetchResult<PrComment[]>> {
    return this.get('reviews', `/repos/${repo}/pulls/${number}/comments?per_page=100`, (raw: RawComment[]) =>
      raw.map((c) => mapComment(c, 'inline')),
    );
  }

  issueComments(repo: string, number: number): Promise<FetchResult<PrComment[]>> {
    return this.get('reviews', `/repos/${repo}/issues/${number}/comments?per_page=100`, (raw: RawComment[]) =>
      raw.map((c) => mapComment(c, 'issue')),
    );
  }

  // commits
  branches(repo: string): Promise<FetchResult<Branch[]>> {
    return this.get('commits', `/repos/${repo}/branches?per_page=100`, (raw: RawBranch[]) => raw.map((b) => mapBranch(repo, b)));
  }

  commits(repo: string, branch: string): Promise<FetchResult<Commit[]>> {
    return this.get('commits', `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=10`, (raw: RawCommit[]) =>
      raw.map((c) => mapCommit(repo, c)),
    );
  }

  /** Lab discovery: top-level Lab<N>/ directories. Trees are immutable per SHA: no ETag needed. */
  labs(repo: string, sha: string): Promise<FetchResult<number[]>> {
    return this.get('commits', `/repos/${repo}/git/trees/${sha}`, (raw: RawTree) => labsFromTree(raw), false);
  }

  // checks
  checkRuns(repo: string, sha: string): Promise<FetchResult<RawCheckRun[]>> {
    return this.get('checks', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`, (raw: RawCheckRunsPage) => raw.check_runs);
  }

  annotations(repo: string, checkRunId: number) {
    return this.get('checks', `/repos/${repo}/check-runs/${checkRunId}/annotations?per_page=50`, (raw: RawAnnotation[]) =>
      raw.map(mapAnnotation),
    );
  }

  // backfill
  compare(repo: string, base: { name: string; sha: string }, head: { name: string; sha: string }): Promise<FetchResult<CompareInfo>> {
    // Compare the exact SHAs we know: the result matches the recorded heads even if a branch moves meanwhile
    return this.get('backfill', `/repos/${repo}/compare/${base.sha}...${head.sha}?per_page=100`, (raw: RawCompare) =>
      mapCompare(base.name, base.sha, head.name, head.sha, raw, new Date()),
    );
  }

  commitFiles(repo: string, sha: string) {
    return this.get('backfill', `/repos/${repo}/commits/${sha}`, (raw: RawCommitDetail) => mapCommitFiles(raw), false);
  }

  /** Recent calls, for the GitHub integration card (latency, last error). */
  private readonly recent: Array<{ at: number; ms: number }> = [];
  private lastOkAt: number | null = null;
  private lastError: { at: number; status: number | null; message: string } | null = null;

  stats(): { avgLatencyMs: number | null; calls: number; lastOkAt: string | null; lastError: { at: string; status: number | null; message: string } | null } {
    const avg = this.recent.length ? Math.round(this.recent.reduce((s, c) => s + c.ms, 0) / this.recent.length) : null;
    return {
      avgLatencyMs: avg,
      calls: this.recent.length,
      lastOkAt: this.lastOkAt ? new Date(this.lastOkAt).toISOString() : null,
      lastError: this.lastError ? { ...this.lastError, at: new Date(this.lastError.at).toISOString() } : null,
    };
  }

  rateLimitSnapshot() {
    return this.budgetImpl.snapshot();
  }

  private async get<Raw, T>(priority: Priority, path: string, map: (raw: Raw) => T, cache = true): Promise<FetchResult<T>> {
    const budget = this.budgetImpl;
    if (!budget.tryAcquire(priority)) {
      throw new BudgetExceededError(priority, budget.msUntilAvailable(priority));
    }
    const started = performance.now();
    try {
      const result = await this.client.getJson(path, map, cache);
      this.recordCall(started, null);
      await this.track(result.rateLimit);
      return result;
    } catch (error) {
      if (error instanceof GithubHttpError) {
        // An HTTP answer (even 404) proves the API is reachable; 401 means the token is bad
        this.recordCall(started, error.status === 401 ? { status: 401, message: 'Bad credentials' } : null);
        if (error.status === 401 && this.authenticated) await this.degradeToAnonymous();
        else await this.track(error.rateLimit);
      } else {
        this.recordCall(started, { status: null, message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  private recordCall(started: number, error: { status: number | null; message: string } | null): void {
    const now = Date.now();
    this.recent.push({ at: now, ms: performance.now() - started });
    if (this.recent.length > 10) this.recent.shift();
    if (error) this.lastError = { at: now, ...error };
    else {
      this.lastOkAt = now;
      this.lastError = null;
    }
  }

  private async persistGrant(at: number): Promise<void> {
    const key = RedisKeys.apiRequests(this.authenticated);
    try {
      await this.redis.zadd(key, at, `${at}-${randomUUID().slice(0, 8)}`);
      await this.redis.zremrangebyscore(key, '-inf', at - HOUR_MS);
    } catch (error) {
      this.logger.warn(`Could not persist the request budget: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async track(info: RateLimitInfo | null): Promise<void> {
    if (!info) return;
    this.budgetImpl.observe(info);
    const rate: RateLimit = { authenticated: this.authenticated, ...info, observedAt: new Date().toISOString() };
    await this.redis.set(RedisKeys.rateLimit, JSON.stringify(rate));
  }
}
