import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisKeys, type Branch, type CiJob, type CiRun, type Commit, type PullRequest, type RateLimit } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, VERSION, type CollectorConfig } from '../config.js';
import { REDIS } from '../infra/tokens.js';
import {
  EtagClient,
  GithubHttpError,
  type CachedResponse,
  type EtagCache,
  type FetchResult,
  type RateLimitInfo,
} from '../logic/etag-client.js';
import {
  mapBranch,
  mapCommit,
  mapJob,
  mapPull,
  mapRun,
  type RawBranch,
  type RawCommit,
  type RawJobsPage,
  type RawPull,
  type RawRunsPage,
} from '../logic/github-map.js';
import { intervalsFor, rateLimitDelay, type PollIntervals } from '../logic/intervals.js';

/** ETags live a day: after that a full response is fetched again, which is fine. */
const ETAG_TTL_S = 24 * 60 * 60;

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly client: EtagClient;
  private rateLimit: RateLimit | null = null;

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
    this.logger.log(
      this.client.authenticated
        ? 'Using GITHUB_TOKEN: 5000 requests/hour, fast polling'
        : 'No GITHUB_TOKEN: 60 requests/hour, slow polling',
    );
  }

  get authenticated(): boolean {
    return this.client.authenticated;
  }

  get intervals(): PollIntervals {
    return intervalsFor(this.authenticated);
  }

  /** How long to hold off because the rate-limit quota is nearly exhausted (0 = go ahead). */
  waitMs(): number {
    return rateLimitDelay(this.rateLimit, new Date());
  }

  runs(repo: string): Promise<FetchResult<CiRun[]>> {
    return this.get(`/repos/${repo}/actions/runs?per_page=30`, (raw: RawRunsPage) =>
      raw.workflow_runs.map((run) => mapRun(repo, run)),
    );
  }

  jobs(repo: string, runId: number): Promise<FetchResult<CiJob[]>> {
    return this.get(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, (raw: RawJobsPage) => raw.jobs.map(mapJob));
  }

  branches(repo: string): Promise<FetchResult<Branch[]>> {
    return this.get(`/repos/${repo}/branches?per_page=100`, (raw: RawBranch[]) => raw.map((b) => mapBranch(repo, b)));
  }

  commits(repo: string, branch: string): Promise<FetchResult<Commit[]>> {
    return this.get(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=10`, (raw: RawCommit[]) =>
      raw.map((c) => mapCommit(repo, c)),
    );
  }

  pulls(repo: string): Promise<FetchResult<PullRequest[]>> {
    return this.get(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`, (raw: RawPull[]) =>
      raw.map((p) => mapPull(repo, p)),
    );
  }

  private async get<Raw, T>(path: string, map: (raw: Raw) => T): Promise<FetchResult<T>> {
    try {
      const result = await this.client.getJson(path, map);
      await this.track(result.rateLimit);
      return result;
    } catch (error) {
      if (error instanceof GithubHttpError) await this.track(error.rateLimit);
      throw error;
    }
  }

  private async track(info: RateLimitInfo | null): Promise<void> {
    if (!info) return;
    this.rateLimit = { authenticated: this.authenticated, ...info, observedAt: new Date().toISOString() };
    await this.redis.set(RedisKeys.rateLimit, JSON.stringify(this.rateLimit));
  }
}
