import { Inject, Injectable } from '@nestjs/common';
import { statusChecks, type DbHandle } from '@labwatch/infra';
import { RedisKeys, STATUS_TARGETS, type LabEvent, type StatusCheck } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, VERSION, type CollectorConfig } from '../config.js';
import { StatusStore } from '../infra/status-store.js';
import { DB, REDIS } from '../infra/tokens.js';
import { httpCheck } from '../logic/http-check.js';
import { classifyCheck, failureReason, incidentAction, statusDownEvent, statusUpEvent } from '../logic/status-check.js';
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
      const event = await this.updateIncident(target, check, failureReason(result));
      if (event) events.push(event);
    }
    await this.store.emit(events);
    await this.store.publish('status');

    if (Date.now() - this.lastRetention > RETENTION_EVERY_MS) await this.retention();

    // Keep a steady cadence: the next round starts one interval after this one started
    return Math.max(1_000, intervalMs - (Date.now() - started));
  }

  /** Opens an incident on the transition to down, resolves it on recovery; returns the event to emit. */
  private async updateIncident(target: (typeof STATUS_TARGETS)[number], check: StatusCheck, reason: string): Promise<LabEvent | null> {
    const at = new Date(check.checkedAt);
    const { rows: open } = await this.db.pool.query<{ id: number; started_at: Date }>(
      'select id, started_at from status_incidents where target = $1 and vantage = $2 and resolved_at is null',
      [target.id, check.vantage],
    );
    switch (incidentAction(check.outcome, open.length > 0)) {
      case 'open': {
        const { rows } = await this.db.pool.query(
          `insert into status_incidents (target, vantage, started_at, failed_checks, last_error)
           values ($1, $2, $3, 1, $4) on conflict do nothing returning id`,
          [target.id, check.vantage, at, reason],
        );
        return rows.length > 0 ? statusDownEvent(target, check.vantage, reason, at) : null;
      }
      case 'extend':
        await this.db.pool.query('update status_incidents set failed_checks = failed_checks + 1, last_error = $2 where id = $1', [
          open[0]!.id,
          reason,
        ]);
        return null;
      case 'resolve': {
        await this.db.pool.query('update status_incidents set resolved_at = $2 where id = $1', [open[0]!.id, at]);
        const downForS = Math.round((at.getTime() - open[0]!.started_at.getTime()) / 1000);
        return statusUpEvent(target, check.vantage, downForS, at);
      }
      case 'none':
        return null;
    }
  }

  private async retention(): Promise<void> {
    this.lastRetention = Date.now();
    const { rowCount } = await this.db.pool.query('delete from status_checks where checked_at < now() - make_interval(days => $1)', [
      this.config.status.retentionDays,
    ]);
    if (rowCount) this.logger.log(`Retention: deleted ${rowCount} status checks older than ${this.config.status.retentionDays} days`);
  }
}
