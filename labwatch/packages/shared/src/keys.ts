/** Services that report a heartbeat into Redis. */
export const SERVICES = ['collector', 'gateway'] as const;
export type ServiceName = (typeof SERVICES)[number];

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A heartbeat key disappears after this many seconds without an update: that means "service down". */
export const HEARTBEAT_TTL_S = 45;

/** Pub/sub channel with "something changed" notifications for live UIs. */
export const UPDATES_CHANNEL = 'updates';
/** Redis stream with the event feed (capped). */
export const EVENTS_STREAM = 'events';
export const EVENTS_STREAM_MAXLEN = 1000;

/** All Redis keys in one place, so the collector (writer) and the gateway (reader) never drift apart. */
export const RedisKeys = {
  health: (service: ServiceName) => `health:${service}`,
  ciStatus: (repo: string) => `status:ci:${repo}`,
  commitsStatus: (repo: string) => `status:commits:${repo}`,
  pullsStatus: (repo: string) => `status:prs:${repo}`,
  sourceStatus: 'status:source',
  rateLimit: 'github:ratelimit',
  etag: (url: string) => `etag:${url}`,
  /** Last known CI conclusion per workflow+branch, for change detection. */
  ciState: (repo: string) => `state:ci:${repo}`,
  /** Last known source state, for change detection. */
  sourceState: 'state:source',
  /** Last known up/down state per service, for change detection in the watchdog. */
  healthState: 'state:health',
} as const;
