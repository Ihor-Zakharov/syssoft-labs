import { Inject, Injectable, Logger } from '@nestjs/common';
import { ciRuns, pageQuery, sourceProbes, type DbHandle } from '@labwatch/infra';
import {
  ApiBudgetSchema,
  HeartbeatSchema,
  INTEGRATION_IDS,
  LabEventSchema,
  RateLimitSchema,
  RedisKeys,
  SERVICES,
  SourceStatusSchema,
  ciStateOf,
  overallStatus,
  type ApiUsage,
  type BranchesView,
  type CiJob,
  type CiRunDetail,
  type CiRunRow,
  type CommitsView,
  type IntegrationStatus,
  type PageArgs,
  type Paged,
  type Overview,
  type PullDetail,
  type PullRow,
  type ServiceHealth,
  type SourceProbe,
  type StatusIncident,
  type StatusPageView,
  type StatusScale,
  type StoredEvent,
} from '@labwatch/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ZodType } from 'zod';
import { CONFIG, type GatewayConfig } from './config.js';
import { DB, REDIS } from './infra/tokens.js';
import { serviceHealth } from './logic/health.js';
import { RepoService } from './repo.service.js';
import { StatusService } from './status.service.js';
import type { DashboardApi } from './trpc/context.js';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());

/** The tRPC API: current state from Redis (fast, small), history from Postgres. */
@Injectable()
export class DashboardService implements DashboardApi {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
    private readonly repo: RepoService,
    private readonly status: StatusService,
  ) {}

  async overview(): Promise<Overview> {
    const [heartbeats, postgres, redis, source, api, statusLevel, commitsStatus] = await Promise.all([
      Promise.all(SERVICES.map(async (name) => serviceHealth(name, await this.json(RedisKeys.health(name), HeartbeatSchema)))),
      this.pingPostgres(),
      this.pingRedis(),
      this.json(RedisKeys.sourceStatus, SourceStatusSchema),
      this.apiUsage(),
      this.status.level().catch(() => 'no_data' as const),
      this.repo.commitsStatus(),
    ]);
    const defaultBranch = commitsStatus?.defaultBranch ?? this.config.defaultBranch;
    const mainHead = commitsStatus?.branches.find((b) => b.name === defaultBranch)?.headSha;
    const mainRuns = mainHead
      ? await this.db.db.select().from(ciRuns).where(and(eq(ciRuns.repo, this.config.repo), eq(ciRuns.headSha, mainHead)))
      : [];
    const mainCi = ciStateOf(mainRuns);
    const services = [...heartbeats, postgres, redis];

    return {
      generatedAt: new Date().toISOString(),
      repos: this.config.repos,
      defaultBranch,
      services,
      source,
      api,
      statusLevel,
      mainCi,
      overall: overallStatus({ services, sourceOk: source?.ok ?? null, mainCi, statusLevel }),
    };
  }

  /** Requests in the last rolling hour (from the collector's sorted set) against its budget. */
  private async apiUsage(): Promise<ApiUsage | null> {
    const budget = await this.json(RedisKeys.apiBudget, ApiBudgetSchema);
    if (!budget) return null;
    const [used, rate] = await Promise.all([
      this.redis.zcount(RedisKeys.apiRequests(budget.authenticated), Date.now() - budget.windowMs, '+inf').catch(() => 0),
      this.json(RedisKeys.rateLimit, RateLimitSchema),
    ]);
    const rateMatches = rate !== null && rate.authenticated === budget.authenticated;
    return {
      authenticated: budget.authenticated,
      tokenRejected: budget.tokenRejected,
      used,
      budgetPerHour: budget.budgetPerHour,
      remaining: rateMatches ? rate.remaining : null,
      limit: rateMatches ? rate.limit : null,
      resetAt: rateMatches ? rate.resetAt : null,
    };
  }

  branches(): Promise<BranchesView> {
    return this.repo.branches();
  }

  ciRuns(args: { branch: string | null } & PageArgs): Promise<Paged<CiRunRow>> {
    return this.repo.ciRuns(args);
  }

  ciRun(runId: number): Promise<CiRunDetail | null> {
    return this.repo.ciRun(runId);
  }

  ciJobs(runId: number): Promise<CiJob[]> {
    return this.repo.ciJobs(runId);
  }

  commits(args: { branch: string | null; area: string | null } & PageArgs): Promise<CommitsView> {
    return this.repo.commits(args);
  }

  pulls(args: { branch: string | null } & PageArgs): Promise<Paged<PullRow>> {
    return this.repo.pulls(args);
  }

  pull(number: number): Promise<PullDetail | null> {
    return this.repo.pull(number);
  }

  statusPage(scale: StatusScale, vantage: string): Promise<StatusPageView> {
    return this.status.statusPage(scale, vantage);
  }

  incidents(args: PageArgs): Promise<Paged<StatusIncident>> {
    return this.status.incidents(args);
  }

  /** Latest check per integration (written by the collector); not checked yet → omitted. */
  async integrations(): Promise<IntegrationStatus[]> {
    const raws = await this.redis.mget(INTEGRATION_IDS.map((id) => RedisKeys.integration(id))).catch(() => []);
    return raws.flatMap((raw) => {
      if (!raw) return [];
      try {
        return [JSON.parse(raw) as IntegrationStatus];
      } catch {
        return [];
      }
    });
  }

  async sourceProbes(limit: number): Promise<SourceProbe[]> {
    const rows = await this.db.db.select().from(sourceProbes).orderBy(desc(sourceProbes.checkedAt)).limit(limit);
    return rows.map(({ id: _id, ...r }) => ({ ...r, checkedAt: iso(r.checkedAt), certValidTo: isoOrNull(r.certValidTo) }));
  }

  /**
   * The event feed, newest first, 15 per page. Paged from Postgres (every event is written there first;
   * the Redis stream is capped and serves live consumers).
   */
  async events(args: PageArgs): Promise<Paged<StoredEvent>> {
    const page = await pageQuery<{ id: number; at: Date; kind: string; severity: string; title: string; data: unknown }>(this.db.pool, {
      from: 'events',
      select: 'id, at, kind, severity, title, data',
      where: 'true',
      params: [],
      timeCol: 'at',
      keyCol: 'id',
      keyType: 'integer',
      page: args.page,
      pageSize: args.pageSize,
      anchor: args.anchor,
    });
    const rows = page.rows.flatMap((r) => {
      const parsed = LabEventSchema.safeParse({ ...r, at: iso(r.at) });
      return parsed.success ? [{ id: `pg-${r.id}`, ...parsed.data }] : [];
    });
    return { ...page, rows };
  }

  private async json<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success) this.logger.warn(`Unexpected shape in Redis key ${key}`);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async pingPostgres(): Promise<ServiceHealth> {
    const started = performance.now();
    try {
      const result = await this.db.pool.query<{ version: string }>("select current_setting('server_version') as version");
      return store('postgres', true, performance.now() - started, result.rows[0]?.version ?? null, null);
    } catch (error) {
      return store('postgres', false, null, null, error instanceof Error ? error.message : String(error));
    }
  }

  private async pingRedis(): Promise<ServiceHealth> {
    const started = performance.now();
    try {
      await this.redis.ping();
      const latency = performance.now() - started;
      const info = await this.redis.info('server');
      return store('redis', true, latency, /redis_version:(\S+)/.exec(info)?.[1] ?? null, null);
    } catch (error) {
      return store('redis', false, null, null, error instanceof Error ? error.message : String(error));
    }
  }
}

function store(name: string, up: boolean, latencyMs: number | null, version: string | null, detail: string | null): ServiceHealth {
  return {
    name,
    kind: 'store',
    up,
    lastSeen: up ? new Date().toISOString() : null,
    latencyMs: latencyMs === null ? null : Math.round(latencyMs * 10) / 10,
    version,
    detail,
  };
}
