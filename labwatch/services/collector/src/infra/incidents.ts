import { Inject, Injectable } from '@nestjs/common';
import type { DbHandle } from '@labwatch/infra';
import type { LabEvent, StatusCheck, StatusTargetConfig } from '@labwatch/shared';
import { incidentAction, statusDownEvent, statusUpEvent } from '../logic/status-check.js';
import { DB } from './tokens.js';

/** Incidents per target and vantage: open on the transition to down, resolve on recovery. */
@Injectable()
export class IncidentTracker {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  /** Applies one check (in time order); returns the event to emit, if the state changed. */
  async apply(target: StatusTargetConfig, check: StatusCheck, reason: string): Promise<LabEvent | null> {
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
}
