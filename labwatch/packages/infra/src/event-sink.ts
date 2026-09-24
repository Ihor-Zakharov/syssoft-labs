import {
  EVENTS_STREAM,
  EVENTS_STREAM_MAXLEN,
  UPDATES_CHANNEL,
  type LabEvent,
  type UpdateMessage,
  type UpdateTopic,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import type { Db } from './connections.js';
import { events } from './schema.js';

/** Tells live UIs which part of the dashboard changed. */
export async function publishUpdate(redis: Redis, topic: UpdateTopic): Promise<void> {
  const message: UpdateMessage = { topic, at: new Date().toISOString() };
  await redis.publish(UPDATES_CHANNEL, JSON.stringify(message));
}

/**
 * Records an event in both stores: Postgres (durable history) and the capped Redis stream (fast feed),
 * then notifies subscribers. Postgres goes first, so an event is never shown that is not persisted.
 */
export async function recordEvent(db: Db, redis: Redis, event: LabEvent): Promise<void> {
  await db.insert(events).values({
    at: new Date(event.at),
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    data: event.data,
  });
  // MAXLEN ~ lets Redis trim in whole macro-nodes: much cheaper than an exact cap
  await redis.xadd(EVENTS_STREAM, 'MAXLEN', '~', EVENTS_STREAM_MAXLEN, '*', 'event', JSON.stringify(event));
  await publishUpdate(redis, 'events');
}
