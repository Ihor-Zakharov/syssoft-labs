import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { publishUpdate, recordEvent, type DbHandle } from '@labwatch/infra';
import {
  EVENTS_STREAM,
  EVENTS_STREAM_MAXLEN,
  HEARTBEAT_INTERVAL_MS,
  RedisKeys,
  SERVICES,
  type LabEvent,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { DB, REDIS } from './infra/tokens.js';
import { diffHealth, type HealthState } from './logic/health.js';

/**
 * Turns "heartbeat key expired" into service.down / service.up events. A service cannot report its
 * own death, so another process must watch it: the gateway watches the collector and Postgres.
 */
@Injectable()
export class WatchdogService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WatchdogService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  onApplicationBootstrap(): void {
    // No check right at startup: services started together would not have written their first
    // heartbeat yet, the watchdog would seed "down" and then report a spurious "back up"
    this.timer = setInterval(() => void this.check(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async check(): Promise<void> {
    try {
      const current: HealthState = {};
      for (const service of SERVICES.filter((s) => s !== 'gateway')) {
        current[service] = (await this.redis.exists(RedisKeys.health(service))) === 1;
      }
      current.postgres = await this.db.pool.query('select 1').then(
        () => true,
        () => false,
      );

      const raw = await this.redis.get(RedisKeys.healthState);
      const { next, events } = diffHealth(raw ? (JSON.parse(raw) as HealthState) : null, current, new Date());
      await this.redis.set(RedisKeys.healthState, JSON.stringify(next));

      for (const event of events) await this.emit(event);
      if (events.length > 0) await publishUpdate(this.redis, 'health');
    } catch (error) {
      // Redis itself is down: nothing to record into; the dashboard shows it via the direct ping
      this.logger.warn(`Watchdog check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async emit(event: LabEvent): Promise<void> {
    this.logger.warn(`${event.kind}: ${event.title}`);
    try {
      await recordEvent(this.db.db, this.redis, event);
    } catch {
      // Postgres is down (maybe that is the event): keep it at least in the Redis feed
      await this.redis.xadd(EVENTS_STREAM, 'MAXLEN', '~', EVENTS_STREAM_MAXLEN, '*', 'event', JSON.stringify(event));
      await publishUpdate(this.redis, 'events');
    }
  }
}
