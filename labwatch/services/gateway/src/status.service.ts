import { Inject, Injectable } from '@nestjs/common';
import { latestChecks, recentIncidents, totalUptime, uptimeBuckets, type DbHandle } from '@labwatch/infra';
import {
  RedisKeys,
  STATUS_TARGETS,
  StatusCheckSchema,
  currentOutcome,
  statusLevel,
  type StatusCheck,
  type StatusIncident,
  type StatusLevel,
  type StatusPageView,
  type StatusScale,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, type GatewayConfig } from './config.js';
import { DB, REDIS } from './infra/tokens.js';

/** Bucket queries scan up to 90 days of checks: reuse a result for a few seconds. */
const CACHE_MS = 10_000;

@Injectable()
export class StatusService {
  private readonly cache = new Map<StatusScale, { at: number; value: Promise<StatusPageView> }>();

  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  /** Latest check per target: Redis first (written every minute), Postgres as the fallback. */
  async latest(): Promise<Map<string, StatusCheck>> {
    const ids = STATUS_TARGETS.map((t) => t.id);
    try {
      const raw = await this.redis.hgetall(RedisKeys.statusLatest(this.config.statusVantage));
      const parsed = new Map(
        Object.entries(raw).flatMap(([target, json]) => {
          const check = StatusCheckSchema.safeParse(JSON.parse(json));
          return check.success ? [[target, check.data] as const] : [];
        }),
      );
      if (ids.every((id) => parsed.has(id))) return parsed;
    } catch {
      // fall through to Postgres
    }
    return latestChecks(this.db.pool, ids, this.config.statusVantage);
  }

  async level(): Promise<StatusLevel> {
    const latest = await this.latest();
    return statusLevel(STATUS_TARGETS.map((t) => latest.get(t.id) ?? null), new Date());
  }

  /** Invalidates cached pages (a new round of checks arrived). */
  invalidate(): void {
    this.cache.clear();
  }

  statusPage(scale: StatusScale): Promise<StatusPageView> {
    const cached = this.cache.get(scale);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const value = this.build(scale);
    this.cache.set(scale, { at: Date.now(), value });
    value.catch(() => this.cache.delete(scale));
    return value;
  }

  private async build(scale: StatusScale): Promise<StatusPageView> {
    const now = new Date();
    const ids = STATUS_TARGETS.map((t) => t.id);
    const [buckets, latest] = await Promise.all([
      uptimeBuckets(this.db.pool, { targets: ids, vantage: this.config.statusVantage, scale, timezone: this.config.statusTimezone, now }),
      this.latest(),
    ]);

    const groups: StatusPageView['groups'] = [];
    for (const target of STATUS_TARGETS) {
      let group = groups.find((g) => g.name === target.group);
      if (!group) groups.push((group = { name: target.group, targets: [] }));
      const targetBuckets = buckets.get(target.id) ?? [];
      const current = latest.get(target.id) ?? null;
      group.targets.push({
        id: target.id,
        name: target.name,
        url: target.url,
        group: target.group,
        current,
        state: currentOutcome(current, now),
        uptime: totalUptime(targetBuckets),
        buckets: targetBuckets,
      });
    }

    return {
      generatedAt: now.toISOString(),
      vantage: this.config.statusVantage,
      vantages: [this.config.statusVantage],
      scale,
      timezone: this.config.statusTimezone,
      level: statusLevel(STATUS_TARGETS.map((t) => latest.get(t.id) ?? null), now),
      groups,
    };
  }

  incidents(limit: number): Promise<StatusIncident[]> {
    return recentIncidents(this.db.pool, {
      vantage: this.config.statusVantage,
      limit,
      names: new Map(STATUS_TARGETS.map((t) => [t.id, t.name])),
    });
  }
}
