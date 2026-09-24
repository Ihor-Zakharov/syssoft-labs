// Status page (statuspage.io style): sites probed from one or more vantage points.

export interface StatusTargetConfig {
  id: string;
  name: string;
  group: string;
  url: string;
  /** HTTP statuses that count as "up" besides 2xx and 3xx (e.g. 401 for a login-protected page). */
  okStatuses?: number[];
}

export const STATUS_TARGETS: readonly StatusTargetConfig[] = [
  { id: 'univ-syssoft', name: 'System software course page', group: 'Lab materials server (91.202.128.107)', url: 'https://91.202.128.107/syssoft/' },
  { id: 'univ-root', name: 'Server home page', group: 'Lab materials server (91.202.128.107)', url: 'https://91.202.128.107/' },
  { id: 'knu-site', name: 'knu.ua', group: 'Taras Shevchenko National University of Kyiv', url: 'https://knu.ua/' },
  { id: 'knu-triton', name: 'Triton student portal', group: 'Taras Shevchenko National University of Kyiv', url: 'https://student.triton.knu.ua/' },
];

/** Where checks are made from. Only this PC for now; a cloud vantage (e.g. aws-eu-central-1) can be added later. */
export const DEFAULT_VANTAGE = 'home';

export const STATUS_OUTCOMES = ['operational', 'degraded', 'down'] as const;
export type StatusOutcome = (typeof STATUS_OUTCOMES)[number];

export const STATUS_LEVELS = ['operational', 'degraded', 'partial_outage', 'major_outage', 'no_data'] as const;
export type StatusLevel = (typeof STATUS_LEVELS)[number];

export const STATUS_LEVEL_LABELS: Record<StatusLevel, string> = {
  operational: 'All Systems Operational',
  degraded: 'Degraded Performance',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  no_data: 'No data',
};

/** Without a check for this long the page shows "No data" (PC off, collector down) — grey, never red. */
export const STATUS_NO_DATA_AFTER_MS = 3 * 60 * 1000;

export interface LatestCheck {
  outcome: StatusOutcome;
  checkedAt: string;
}

export function isFresh(check: LatestCheck | null, now: Date, noDataAfterMs = STATUS_NO_DATA_AFTER_MS): check is LatestCheck {
  return check !== null && now.getTime() - new Date(check.checkedAt).getTime() <= noDataAfterMs;
}

/** Current state of one target: its last check if recent enough, otherwise no data. */
export function currentOutcome(check: LatestCheck | null, now: Date, noDataAfterMs = STATUS_NO_DATA_AFTER_MS): StatusOutcome | 'no_data' {
  return isFresh(check, now, noDataAfterMs) ? check.outcome : 'no_data';
}

/**
 * Page banner from the latest check of every target. Stale targets are unknown, not down.
 * Down on all or a majority (more than half) of the fresh targets → major outage; some down → partial.
 */
export function statusLevel(latest: ReadonlyArray<LatestCheck | null>, now: Date, noDataAfterMs = STATUS_NO_DATA_AFTER_MS): StatusLevel {
  const fresh = latest.filter((c): c is LatestCheck => isFresh(c, now, noDataAfterMs));
  if (fresh.length === 0) return 'no_data';
  const down = fresh.filter((c) => c.outcome === 'down').length;
  if (down > 0) return down * 2 > fresh.length ? 'major_outage' : 'partial_outage';
  return fresh.some((c) => c.outcome === 'degraded') ? 'degraded' : 'operational';
}

// Uptime bars: the scale switch and how each scale is split into buckets.

export const STATUS_SCALES = {
  '1h': { buckets: 60, bucketSeconds: 60, label: '1 hour' },
  '24h': { buckets: 96, bucketSeconds: 15 * 60, label: '24 hours' },
  '7d': { buckets: 84, bucketSeconds: 2 * 60 * 60, label: '7 days' },
  '30d': { buckets: 30, bucketSeconds: 24 * 60 * 60, label: '30 days' },
  '90d': { buckets: 90, bucketSeconds: 24 * 60 * 60, label: '90 days' },
} as const;
export type StatusScale = keyof typeof STATUS_SCALES;
export const STATUS_SCALE_KEYS = Object.keys(STATUS_SCALES) as StatusScale[];
export const DEFAULT_STATUS_SCALE: StatusScale = '24h';

export function isStatusScale(value: string): value is StatusScale {
  return (STATUS_SCALE_KEYS as string[]).includes(value);
}

/** Share of checks that were up (operational or degraded); null when there were no checks. */
export function uptimeRatio(up: number, total: number): number | null {
  return total > 0 ? up / total : null;
}

export type UptimeTone = 'great' | 'good' | 'fair' | 'poor' | 'none';

/** Bar colour: ≥99.9 % green, ≥99 % light green, ≥95 % yellow, below red, no data grey. */
export function uptimeTone(ratio: number | null): UptimeTone {
  if (ratio === null) return 'none';
  if (ratio >= 0.999) return 'great';
  if (ratio >= 0.99) return 'good';
  if (ratio >= 0.95) return 'fair';
  return 'poor';
}

/** "99.93 %", "100 %", "—" */
export function formatUptime(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio === 1) return '100%';
  return `${(Math.floor(ratio * 10000) / 100).toFixed(2)}%`;
}
