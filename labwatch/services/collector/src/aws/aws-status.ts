import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { insertChecksIfMissing, newestCheckAt, type DbHandle } from '@labwatch/infra';
import { RedisKeys, STATUS_TARGETS, type LabEvent, type OurConnection, type StatusCheck } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, type CollectorConfig } from '../config.js';
import { IncidentTracker } from '../infra/incidents.js';
import { StatusStore } from '../infra/status-store.js';
import { DB, REDIS } from '../infra/tokens.js';
import type { AwsProbeReader } from '../integrations/integrations.service.js';
import { awsConnection, awsErrorConnection, checkFromItem, classifyAwsError, queryChecks, type QueryClient } from '../logic/aws-status.js';
import { failureReason } from '../logic/status-check.js';
import { PollingService } from '../pollers/polling-service.js';

export const DYNAMO = Symbol('DYNAMO');

/** DynamoDB client when the reader's credentials are in the environment, otherwise null. */
export function createDynamoClient(config: CollectorConfig): QueryClient | null {
  return config.aws.configured ? new DynamoDBClient({ region: config.aws.region, maxAttempts: 3 }) : null;
}

const NAMES = new Map(STATUS_TARGETS.map((t) => [t.id, t.name]));
const PAGE_SIZE = 50;
/** Per target and round: 30 pages × 50 = 1500 checks (a day is 1440), the rest follows next round. */
const MAX_PAGES = 30;
/** Older checks are backfilled into history without raising events (they would be news from the past). */
const EVENT_MAX_AGE_MS = 10 * 60_000;

/** AWS card: the newest check of every site, straight from DynamoDB (4 tiny queries a minute). */
export class DynamoAwsProbeReader implements AwsProbeReader {
  private readonly logger = new Logger('AwsProbeReader');

  constructor(
    private readonly client: QueryClient,
    private readonly config: CollectorConfig['aws'],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async latest(): Promise<OurConnection> {
    const started = performance.now();
    const { region, table, vantage } = this.config;
    try {
      const pages = await Promise.all(
        STATUS_TARGETS.map((t) => queryChecks(this.client, { table, targetId: t.id, newestFirst: true, limit: 1, maxPages: 1 })),
      );
      const latest = pages.flatMap((page, i) => {
        const item = page.items[0];
        const check = item ? checkFromItem(item, STATUS_TARGETS[i]!.id, vantage) : null;
        return check ? [check] : [];
      });
      return awsConnection({ latest, names: NAMES, now: this.now(), queryLatencyMs: Math.round(performance.now() - started), region, table });
    } catch (error) {
      const info = classifyAwsError(error);
      this.logger.warn(`Reading ${table} failed — ${info.name}: ${info.message}`);
      return awsErrorConnection(info, { now: this.now(), region, table });
    }
  }
}

/**
 * Copies the AWS prober's checks into Postgres (vantage aws-eu-central-1) every AWS_STATUS_SYNC_INTERVAL_S:
 * incrementally per site from the last synced check, so the status bars are filled for the time the PC
 * was off, too. Idempotent: a re-read page inserts nothing twice.
 */
@Injectable()
export class AwsStatusSync extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DYNAMO) private readonly client: QueryClient | null,
    private readonly store: StatusStore,
    private readonly incidents: IncidentTracker,
  ) {
    super('AwsStatusSync', 10_000);
  }

  override onApplicationBootstrap(): void {
    if (this.client) super.onApplicationBootstrap();
    else this.logger.log('AWS sync off: no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for the reader user');
  }

  protected async poll(): Promise<number> {
    try {
      const result = await this.syncOnce();
      if (result.inserted > 0) this.logger.log(`Synced ${result.inserted} AWS checks${result.more ? ' (more to come)' : ''}`);
      // Catching up after a long gap: continue right away instead of waiting a whole interval
      return result.more ? 5_000 : this.config.aws.syncIntervalMs;
    } catch (error) {
      const info = classifyAwsError(error);
      this.logger.warn(`AWS sync failed — ${info.name}: ${info.message}`);
      return this.config.aws.syncIntervalMs;
    }
  }

  /** One round for all sites. `more` = a site has more checks than one round reads. */
  async syncOnce(now = new Date()): Promise<{ inserted: number; more: boolean }> {
    if (!this.client) return { inserted: 0, more: false };
    const { table, vantage } = this.config.aws;
    let inserted = 0;
    let more = false;
    const latest: Record<string, string> = {};
    const events: LabEvent[] = [];

    for (const target of STATUS_TARGETS) {
      const after = await this.cursor(target.id, now);
      const page = await queryChecks(this.client, { table, targetId: target.id, afterSk: after, limit: PAGE_SIZE, maxPages: MAX_PAGES });
      more ||= page.truncated;
      const checks = page.items
        .map((item) => checkFromItem(item, target.id, vantage))
        .filter((c): c is StatusCheck => c !== null)
        .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
      if (checks.length === 0) continue;

      inserted += await insertChecksIfMissing(this.db.pool, checks);
      for (const check of checks) {
        const event = await this.incidents.apply(target, check, failureReason(check));
        if (event && now.getTime() - new Date(check.checkedAt).getTime() <= EVENT_MAX_AGE_MS) events.push(event);
      }
      const last = checks.at(-1)!;
      // The cursor is the sort key as stored in DynamoDB, so `sk > cursor` compares like with like
      await this.redis.set(RedisKeys.awsSyncCursor(target.id), page.items.at(-1)?.['sk']?.S ?? last.checkedAt);
      latest[target.id] = JSON.stringify(last);
    }

    if (Object.keys(latest).length > 0) await this.redis.hset(RedisKeys.statusLatest(vantage), latest);
    await this.store.emit(events);
    if (inserted > 0) await this.store.publish('status');
    return { inserted, more };
  }

  /** Last synced check: Redis, else the newest stored row, else the backfill window. */
  private async cursor(target: string, now: Date): Promise<string> {
    const cached = await this.redis.get(RedisKeys.awsSyncCursor(target));
    if (cached) return cached;
    const stored = await newestCheckAt(this.db.pool, target, this.config.aws.vantage);
    return (stored ?? new Date(now.getTime() - this.config.aws.backfillHours * 3_600_000)).toISOString();
  }
}
