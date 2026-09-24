import { Inject, Injectable, Logger } from '@nestjs/common';
import { ciJobs, ciRuns, commits, events, pullRequests, sourceProbes, type DbHandle } from '@labwatch/infra';
import {
  CiStatusSchema,
  CommitsStatusSchema,
  EVENTS_STREAM,
  HeartbeatSchema,
  LabEventSchema,
  RateLimitSchema,
  RedisKeys,
  SERVICES,
  SourceStatusSchema,
  type Branch,
  type CiJob,
  type CiRun,
  type CiStatus,
  type CommitsView,
  type Overview,
  type PullRequest,
  type ServiceHealth,
  type SourceProbe,
  type StoredEvent,
} from '@labwatch/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ZodType } from 'zod';
import { CONFIG, type GatewayConfig } from './config.js';
import { DB, REDIS } from './infra/tokens.js';
import { serviceHealth } from './logic/health.js';
import type { DashboardApi } from './trpc/context.js';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());

/** Reads: current state from Redis (fast, small), history from Postgres. */
@Injectable()
export class DashboardService implements DashboardApi {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  async overview(): Promise<Overview> {
    const [heartbeats, postgres, redis, source, ci, rateLimit] = await Promise.all([
      Promise.all(SERVICES.map(async (name) => serviceHealth(name, await this.json(RedisKeys.health(name), HeartbeatSchema)))),
      this.pingPostgres(),
      this.pingRedis(),
      this.json(RedisKeys.sourceStatus, SourceStatusSchema),
      Promise.all(this.config.repos.map((repo) => this.json(RedisKeys.ciStatus(repo), CiStatusSchema))),
      this.json(RedisKeys.rateLimit, RateLimitSchema),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      repos: this.config.repos,
      services: [...heartbeats, postgres, redis],
      source,
      ci: ci.filter((s): s is CiStatus => s !== null),
      rateLimit,
    };
  }

  async ciRuns(limit: number): Promise<CiRun[]> {
    const rows = await this.db.db.select().from(ciRuns).orderBy(desc(ciRuns.createdAt)).limit(limit);
    return rows.map((r) => ({
      ...r,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
      runStartedAt: isoOrNull(r.runStartedAt),
    }));
  }

  async ciJobs(runId: number): Promise<CiJob[]> {
    const rows = await this.db.db.select().from(ciJobs).where(eq(ciJobs.runId, runId)).orderBy(asc(ciJobs.startedAt));
    return rows.map((r) => ({ ...r, startedAt: isoOrNull(r.startedAt), completedAt: isoOrNull(r.completedAt) }));
  }

  async commits(limit: number): Promise<CommitsView> {
    const [rows, statuses] = await Promise.all([
      this.db.db.select().from(commits).orderBy(desc(commits.committedAt)).limit(limit),
      Promise.all(this.config.repos.map((repo) => this.json(RedisKeys.commitsStatus(repo), CommitsStatusSchema))),
    ]);
    const branches: Branch[] = statuses.flatMap((s) => s?.branches ?? []);
    return { branches, commits: rows.map((r) => ({ ...r, committedAt: iso(r.committedAt) })) };
  }

  async pulls(limit: number): Promise<PullRequest[]> {
    const rows = await this.db.db.select().from(pullRequests).orderBy(desc(pullRequests.updatedAt)).limit(limit);
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }));
  }

  async sourceProbes(limit: number): Promise<SourceProbe[]> {
    const rows = await this.db.db.select().from(sourceProbes).orderBy(desc(sourceProbes.checkedAt)).limit(limit);
    return rows.map(({ id: _id, ...r }) => ({ ...r, checkedAt: iso(r.checkedAt), certValidTo: isoOrNull(r.certValidTo) }));
  }

  /** The capped Redis stream serves the feed; Postgres is the fallback when Redis lost it. */
  async events(limit: number): Promise<StoredEvent[]> {
    const entries = await this.redis.xrevrange(EVENTS_STREAM, '+', '-', 'COUNT', limit).catch(() => []);
    const fromStream = entries.flatMap(([id, fields]) => {
      const raw = fields[fields.indexOf('event') + 1];
      const parsed = raw === undefined ? null : LabEventSchema.safeParse(JSON.parse(raw));
      return parsed?.success ? [{ id, ...parsed.data }] : [];
    });
    if (fromStream.length > 0) return fromStream;

    const rows = await this.db.db.select().from(events).orderBy(desc(events.at)).limit(limit);
    return rows.flatMap((r) => {
      const parsed = LabEventSchema.safeParse({ ...r, at: iso(r.at) });
      return parsed.success ? [{ id: `pg-${r.id}`, ...parsed.data }] : [];
    });
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
