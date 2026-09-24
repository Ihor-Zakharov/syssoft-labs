import { Inject, Injectable } from '@nestjs/common';
import { latestChecks, recentIncidents, totalUptime, uptimeBuckets, type DbHandle } from '@labwatch/infra';
import {
  RedisKeys,
  STATUS_TARGETS,
  StatusCheckSchema,
  combinedOutcome,
  currentOutcome,
  levelFromStates,
  vantageLabel,
  type StatusCheck,
  type StatusIncident,
  type StatusLevel,
  type StatusPageView,
  type StatusScale,
  type StatusVantageInfo,
  type TargetState,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, type GatewayConfig } from './config.js';
import { DB, REDIS } from './infra/tokens.js';

/** Bucket queries scan up to 90 days of checks: reuse a result for a few seconds. */
const CACHE_MS = 10_000;
export const ALL_VANTAGES = 'all';

@Injectable()
export class StatusService {
  private readonly cache = new Map<string, { at: number; value: Promise<StatusPageView> }>();

  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  /** Latest check per target from one vantage: Redis first (written by the collector), Postgres as the fallback. */
  async latest(vantage: string): Promise<Map<string, StatusCheck>> {
    const ids = STATUS_TARGETS.map((t) => t.id);
    try {
      const raw = await this.redis.hgetall(RedisKeys.statusLatest(vantage));
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
    return latestChecks(this.db.pool, ids, vantage);
  }

  /** Latest checks of every configured vantage. */
  private async latestByVantage(vantages: readonly string[]): Promise<Map<string, Map<string, StatusCheck>>> {
    const entries = await Promise.all(vantages.map(async (v) => [v, await this.latest(v)] as const));
    return new Map(entries);
  }

  /** Banner level over all vantages (a site down from one vantage only is a partial outage). */
  async level(): Promise<StatusLevel> {
    const latest = await this.latestByVantage(this.config.statusVantages);
    const now = new Date();
    return levelFromStates(STATUS_TARGETS.map((t) => combinedOutcome([...latest.values()].map((m) => m.get(t.id) ?? null), now)));
  }

  /** Invalidates cached pages (a new round of checks arrived). */
  invalidate(): void {
    this.cache.clear();
  }

  statusPage(scale: StatusScale, vantage: string = ALL_VANTAGES): Promise<StatusPageView> {
    const selected = this.config.statusVantages.includes(vantage) ? vantage : ALL_VANTAGES;
    const key = `${scale}:${selected}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const value = this.build(scale, selected);
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  private async build(scale: StatusScale, selected: string): Promise<StatusPageView> {
    const now = new Date();
    const ids = STATUS_TARGETS.map((t) => t.id);
    const all = this.config.statusVantages;
    const vantages = selected === ALL_VANTAGES ? all : [selected];
    const [buckets, latest] = await Promise.all([
      uptimeBuckets(this.db.pool, { targets: ids, vantages, scale, timezone: this.config.statusTimezone, now }),
      this.latestByVantage(all),
    ]);

    const groups: StatusPageView['groups'] = [];
    const states: TargetState[] = [];
    for (const target of STATUS_TARGETS) {
      let group = groups.find((g) => g.name === target.group);
      if (!group) groups.push((group = { name: target.group, targets: [] }));
      const perVantage = vantages.map((v) => {
        const current = latest.get(v)?.get(target.id) ?? null;
        return { vantage: v, label: vantageLabel(v), current, state: currentOutcome(current, now) };
      });
      const state = combinedOutcome(perVantage.map((p) => p.current), now);
      states.push(state);
      const newest = perVantage
        .map((p) => p.current)
        .filter((c): c is StatusCheck => c !== null)
        .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
      const targetBuckets = buckets.get(target.id) ?? [];
      group.targets.push({
        id: target.id,
        name: target.name,
        url: target.url,
        group: target.group,
        current: newest ?? null,
        state,
        vantages: perVantage,
        uptime: totalUptime(targetBuckets),
        buckets: targetBuckets,
      });
    }

    const vantageInfo: StatusVantageInfo[] = all.map((v) => {
      const newest = [...(latest.get(v)?.values() ?? [])].map((c) => c.checkedAt).sort().at(-1) ?? null;
      return { id: v, label: vantageLabel(v), lastCheckAt: newest };
    });

    return {
      generatedAt: now.toISOString(),
      vantage: selected,
      vantages: vantageInfo,
      scale,
      timezone: this.config.statusTimezone,
      level: levelFromStates(states),
      groups,
    };
  }

  incidents(limit: number): Promise<StatusIncident[]> {
    return recentIncidents(this.db.pool, {
      vantages: this.config.statusVantages,
      limit,
      names: new Map(STATUS_TARGETS.map((t) => [t.id, t.name])),
    });
  }
}
