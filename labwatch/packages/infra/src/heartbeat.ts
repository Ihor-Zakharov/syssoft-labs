import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TTL_S,
  RedisKeys,
  type Heartbeat,
  type ServiceName,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';

/**
 * Writes health:<service> every 15 s with a 45 s TTL. If the process hangs or dies, the key simply
 * expires — "down" needs no separate prober. Returns a function that stops the heartbeat.
 */
export function startHeartbeat(redis: Redis, service: ServiceName, version: string, onError?: (e: unknown) => void): () => void {
  const startedAt = new Date().toISOString();
  const beat = async () => {
    const heartbeat: Heartbeat = { service, at: new Date().toISOString(), pid: process.pid, version, startedAt };
    try {
      await redis.set(RedisKeys.health(service), JSON.stringify(heartbeat), 'EX', HEARTBEAT_TTL_S);
    } catch (e) {
      onError?.(e);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
