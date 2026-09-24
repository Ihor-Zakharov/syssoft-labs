import { Inject, Injectable, Logger } from '@nestjs/common';
import { publishUpdate, recordEvent, type DbHandle } from '@labwatch/infra';
import type { LabEvent, UpdateTopic } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { DB, REDIS } from './tokens.js';

/** Current state ("what is it now") goes to Redis as JSON; events go to both stores. */
@Injectable()
export class StatusStore {
  private readonly logger = new Logger(StatusStore.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  async setJson(key: string, value: unknown): Promise<void> {
    await this.redis.set(key, JSON.stringify(value));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async emit(events: readonly LabEvent[]): Promise<void> {
    for (const event of events) {
      await recordEvent(this.db.db, this.redis, event);
      this.logger.log(`[${event.severity}] ${event.kind}: ${event.title}`);
    }
  }

  async publish(topic: UpdateTopic): Promise<void> {
    await publishUpdate(this.redis, topic);
  }
}
