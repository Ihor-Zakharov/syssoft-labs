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
  private readonly client: EtagClient;
  readonly budget: RequestBudget;

  constructor(
    @Inject(CONFIG) config: CollectorConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    const cache: EtagCache = {
      get: async <T>(url: string) => {
        const raw = await redis.get(RedisKeys.etag(url));
        return raw === null ? null : (JSON.parse(raw) as CachedResponse<T>);
      },
      set: async <T>(url: string, value: CachedResponse<T>) => {
        await redis.set(RedisKeys.etag(url), JSON.stringify(value), 'EX', ETAG_TTL_S);
      },
    };
    this.client = new EtagClient({
      fetch: globalThis.fetch,
      cache,
      token: config.githubToken,
      userAgent: `labwatch-collector/${VERSION}`,
    });
    const budgetPerHour = this.client.authenticated ? config.authBudgetPerHour : config.unauthBudgetPerHour;
    this.budget = new RequestBudget({ budgetPerHour, onGrant: (at) => void this.persistGrant(at) });
    this.logger.log(
      this.client.authenticated
        ? `Using GITHUB_TOKEN: budget ${budgetPerHour} requests/hour`
        : `No GITHUB_TOKEN: budget ${budgetPerHour} of GitHub's 60 requests/hour, slow polling`,
    );
  }

  async onModuleInit(): Promise<void> {
    // Continue the rolling window of the previous process: a restart must not reset the budget
    const since = Date.now() - HOUR_MS;
    await this.redis.zremrangebyscore(RedisKeys.apiRequests, '-inf', since);
    const stamps = await this.redis.zrangebyscore(RedisKeys.apiRequests, since, '+inf', 'WITHSCORES');
    this.budget.seed(stamps.filter((_, i) => i % 2 === 1).map(Number));
    const budget: ApiBudget = { authenticated: this.authenticated, budgetPerHour: this.budget.budgetPerHour, windowMs: HOUR_MS };
    await this.redis.set(RedisKeys.apiBudget, JSON.stringify(budget));
    this.logger.log(`GitHub requests in the last hour: ${this.budget.used()}/${this.budget.budgetPerHour}`);
  }

  get authenticated(): boolean {
    return this.client.authenticated;
  }

  get intervals(): PollIntervals {
    return intervalsFor(this.authenticated);
  }

  /** Whether a call of this priority would be granted right now (no request is made). */
  canCall(priority: Priority): boolean {
    return this.budget.msUntilAvailable(priority) === 0;
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

  private async get<Raw, T>(priority: Priority, path: string, map: (raw: Raw) => T, cache = true): Promise<FetchResult<T>> {
    if (!this.budget.tryAcquire(priority)) {
      throw new BudgetExceededError(priority, this.budget.msUntilAvailable(priority));
    }
    try {
      const result = await this.client.getJson(path, map, cache);
      await this.track(result.rateLimit);
      return result;
    } catch (error) {
      if (error instanceof GithubHttpError) await this.track(error.rateLimit);
      throw error;
    }
  }

  private async persistGrant(at: number): Promise<void> {
    try {
      await this.redis.zadd(RedisKeys.apiRequests, at, `${at}-${randomUUID().slice(0, 8)}`);
      await this.redis.zremrangebyscore(RedisKeys.apiRequests, '-inf', at - HOUR_MS);
    } catch (error) {
      this.logger.warn(`Could not persist the request budget: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async track(info: RateLimitInfo | null): Promise<void> {
    if (!info) return;
    this.budget.observe(info);
    const rate: RateLimit = { authenticated: this.authenticated, ...info, observedAt: new Date().toISOString() };
    await this.redis.set(RedisKeys.rateLimit, JSON.stringify(rate));
  }
}
