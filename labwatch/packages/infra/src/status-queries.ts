import { STATUS_SCALES, uptimeRatio, type StatusCheck, type StatusIncident, type StatusScale, type UptimeBucket } from '@labwatch/shared';

/** pg.Pool or a pg.Client (e.g. inside a transaction in tests). */
export interface Queryable {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

interface BucketRow {
  target: string;
  start: Date;
  end: Date;
  total: number;
  up: number;
  degraded: number;
  down: number;
  avg_latency: number | null;
  p95_latency: number | null;
}

/**
 * Uptime buckets for a scale, computed in SQL. Buckets are aligned in the given time zone
 * (whole local minutes / quarter hours / even hours / local days) with date_bin, the frame comes
 * from generate_series so buckets without checks are returned too (as "no data").
 * Degraded checks count as up; latency statistics only cover checks that got an answer.
 */
export async function uptimeBuckets(
  db: Queryable,
  args: { targets: readonly string[]; vantage: string; scale: StatusScale; timezone: string; now?: Date },
): Promise<Map<string, UptimeBucket[]>> {
  const { buckets, bucketSeconds } = STATUS_SCALES[args.scale];
  const { rows } = await db.query<BucketRow>(
    `with bounds as (
       select date_bin(make_interval(secs => $3), $6::timestamptz at time zone $4, timestamp '2000-01-03') as last_start
     ), frame as (
       select last_start - make_interval(secs => $3 * ($5 - 1)) as first_start, last_start from bounds
     ), series as (
       select t.target, gs as bucket
       from unnest($1::text[]) as t(target)
       cross join frame
       cross join generate_series(frame.first_start, frame.last_start, make_interval(secs => $3)) as gs
     ), agg as (
       select c.target,
              date_bin(make_interval(secs => $3), c.checked_at at time zone $4, timestamp '2000-01-03') as bucket,
              count(*)::int as total,
              (count(*) filter (where c.outcome <> 'down'))::int as up,
              (count(*) filter (where c.outcome = 'degraded'))::int as degraded,
              (count(*) filter (where c.outcome = 'down'))::int as down,
              round(avg(c.latency_ms) filter (where c.outcome <> 'down'))::int as avg_latency,
              round((percentile_cont(0.95) within group (order by c.latency_ms) filter (where c.outcome <> 'down'))::numeric)::int as p95_latency
       from status_checks c, frame
       where c.target = any($1::text[]) and c.vantage = $2
         and c.checked_at >= frame.first_start at time zone $4
         and c.checked_at < (frame.last_start + make_interval(secs => $3)) at time zone $4
       group by 1, 2
     )
     select s.target,
            s.bucket at time zone $4 as start,
            (s.bucket + make_interval(secs => $3)) at time zone $4 as "end",
            coalesce(a.total, 0) as total, coalesce(a.up, 0) as up,
            coalesce(a.degraded, 0) as degraded, coalesce(a.down, 0) as down,
            a.avg_latency, a.p95_latency
     from series s left join agg a on a.target = s.target and a.bucket = s.bucket
     order by s.target, s.bucket`,
    [args.targets, args.vantage, bucketSeconds, args.timezone, buckets, (args.now ?? new Date()).toISOString()],
  );

  const result = new Map<string, UptimeBucket[]>(args.targets.map((t) => [t, []]));
  for (const row of rows) {
    result.get(row.target)?.push({
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      total: row.total,
      up: row.up,
      degraded: row.degraded,
      down: row.down,
      uptime: uptimeRatio(row.up, row.total),
      avgLatencyMs: row.avg_latency,
      p95LatencyMs: row.p95_latency,
    });
  }
  return result;
}

/** Uptime over all buckets of a scale (checks-weighted, not an average of bucket percentages). */
export function totalUptime(buckets: readonly UptimeBucket[]): number | null {
  const total = buckets.reduce((sum, b) => sum + b.total, 0);
  const up = buckets.reduce((sum, b) => sum + b.up, 0);
  return uptimeRatio(up, total);
}

interface CheckRow {
  target: string;
  vantage: string;
  checked_at: Date;
  outcome: StatusCheck['outcome'];
  http_status: number | null;
  latency_ms: number | null;
  tls_ok: boolean | null;
  tls_error: string | null;
  error: string | null;
}

/** The newest check of every target (index-only lookups thanks to (target, vantage, checked_at)). */
export async function latestChecks(db: Queryable, targets: readonly string[], vantage: string): Promise<Map<string, StatusCheck>> {
  const { rows } = await db.query<CheckRow>(
    `select c.* from unnest($1::text[]) as t(target)
     cross join lateral (
       select target, vantage, checked_at, outcome, http_status, latency_ms, tls_ok, tls_error, error
       from status_checks where target = t.target and vantage = $2
       order by checked_at desc limit 1
     ) c`,
    [targets, vantage],
  );
  return new Map(
    rows.map((r) => [
      r.target,
      {
        target: r.target,
        vantage: r.vantage,
        checkedAt: r.checked_at.toISOString(),
        outcome: r.outcome,
        httpStatus: r.http_status,
        latencyMs: r.latency_ms,
        tlsOk: r.tls_ok,
        tlsError: r.tls_error,
        error: r.error,
      },
    ]),
  );
}

interface IncidentRow {
  id: number;
  target: string;
  vantage: string;
  started_at: Date;
  resolved_at: Date | null;
  failed_checks: number;
  last_error: string | null;
}

export async function recentIncidents(
  db: Queryable,
  args: { vantage: string; limit: number; names: ReadonlyMap<string, string>; now?: Date },
): Promise<StatusIncident[]> {
  const { rows } = await db.query<IncidentRow>(
    `select id, target, vantage, started_at, resolved_at, failed_checks, last_error
     from status_incidents where vantage = $1 order by started_at desc limit $2`,
    [args.vantage, args.limit],
  );
  const now = args.now ?? new Date();
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    targetName: args.names.get(r.target) ?? r.target,
    vantage: r.vantage,
    startedAt: r.started_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    durationS: Math.max(0, Math.round(((r.resolved_at ?? now).getTime() - r.started_at.getTime()) / 1000)),
    failedChecks: r.failed_checks,
    lastError: r.last_error,
  }));
}
