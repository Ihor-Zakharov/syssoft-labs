import { Inject, Injectable } from '@nestjs/common';
import { statusChecks, type DbHandle } from '@labwatch/infra';
import { RedisKeys, STATUS_TARGETS, type LabEvent, type StatusCheck } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, VERSION, type CollectorConfig } from '../config.js';
import { IncidentTracker } from '../infra/incidents.js';
import { StatusStore } from '../infra/status-store.js';
import { DB, REDIS } from '../infra/tokens.js';
import { httpCheck } from '../logic/http-check.js';
import { classifyCheck, failureReason } from '../logic/status-check.js';
import { PollingService } from './polling-service.js';

const RETENTION_EVERY_MS = 60 * 60 * 1000;

/** Status page: checks every target once a minute from this vantage point, keeps incidents. */
@Injectable()
export class StatusPoller extends PollingService {
  private lastRetention = 0;

  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: StatusStore,
    private readonly incidents: IncidentTracker,
  ) {
    super('StatusPoller', 3_000);
  }

  override onApplicationBootstrap(): void {
    if (this.config.status.enabled) super.onApplicationBootstrap();
    else this.logger.log('Status checks disabled (STATUS_ENABLED=false)');
  }

  protected async poll(): Promise<number> {
    const started = Date.now();
    const { vantage, timeoutMs, degradedMs, intervalMs } = this.config.status;

    const results = await Promise.all(
      STATUS_TARGETS.map(async (target) => {
        const result = await httpCheck(target.url, { timeoutMs, userAgent: `labwatch-status/${VERSION}` });
        const check: StatusCheck = {
          target: target.id,
          vantage,
          checkedAt: new Date().toISOString(),
          outcome: classifyCheck(result, { degradedMs, okStatuses: target.okStatuses }),
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
          tlsOk: result.tlsOk,
          tlsError: result.tlsError,
          error: result.error,
        };
        return { target, result, check };
      }),
    );

    await this.db.db.insert(statusChecks).values(
      results.map(({ check }) => ({
        target: check.target,
        vantage: check.vantage,
        checkedAt: new Date(check.checkedAt),
        outcome: check.outcome,
        httpStatus: check.httpStatus,
        latencyMs: check.latencyMs,
        tlsOk: check.tlsOk,
        tlsError: check.tlsError,
        error: check.error,
      })),
    );
    await this.redis.hset(RedisKeys.statusLatest(vantage), Object.fromEntries(results.map(({ check }) => [check.target, JSON.stringify(check)])));

    const events: LabEvent[] = [];
    for (const { target, result, check } of results) {
      const event = await this.incidents.apply(target, check, failureReason(result));
      if (event) events.push(event);
    }
    await this.store.emit(events);
    await this.store.publish('status');

    if (Date.now() - this.lastRetention > RETENTION_EVERY_MS) await this.retention();

    // Keep a steady cadence: the next round starts one interval after this one started
    return Math.max(1_000, intervalMs - (Date.now() - started));
  }

  private async retention(): Promise<void> {
    this.lastRetention = Date.now();
    const { rowCount } = await this.db.pool.query('delete from status_checks where checked_at < now() - make_interval(days => $1)', [
      this.config.status.retentionDays,
    ]);
    if (rowCount) this.logger.log(`Retention: deleted ${rowCount} status checks older than ${this.config.status.retentionDays} days`);
  }
}
