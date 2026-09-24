import type { Heartbeat, LabEvent, ServiceHealth } from '@labwatch/shared';

/** A missing key means the TTL expired: no heartbeat for 45 s → down. */
export function serviceHealth(name: string, heartbeat: Heartbeat | null): ServiceHealth {
  return {
    name,
    kind: 'service',
    up: heartbeat !== null,
    lastSeen: heartbeat?.at ?? null,
    latencyMs: null,
    version: heartbeat?.version ?? null,
    detail: heartbeat ? `pid ${heartbeat.pid}, up since ${heartbeat.startedAt}` : 'no heartbeat for 45 s',
  };
}

export type HealthState = Record<string, boolean>;

/** service.down / service.up only on transitions; the first observation seeds silently. */
export function diffHealth(prev: HealthState | null, current: HealthState, now: Date): { next: HealthState; events: LabEvent[] } {
  const next = { ...(prev ?? {}), ...current };
  if (prev === null) return { next, events: [] };

  const events: LabEvent[] = [];
  for (const [service, up] of Object.entries(current)) {
    const before = prev[service];
    if (before === undefined || before === up) continue;
    events.push(
      up
        ? { kind: 'service.up', severity: 'info', title: `${service} is back up`, at: now.toISOString(), data: { service } }
        : { kind: 'service.down', severity: 'error', title: `${service} is down`, at: now.toISOString(), data: { service } },
    );
  }
  return { next, events };
}
