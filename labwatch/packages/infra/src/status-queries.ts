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
 *
 * Several vantages (home, AWS) are combined per minute: a minute counts as up when ANY vantage got
 * an answer (degraded answers count as up), and as degraded when none got a fast one. So the bars
 * count minutes, and while one vantage is off (the PC) the other one still fills them.
 * Latency statistics cover every answered check of the selected vantages.
 */
export async function uptimeBuckets(
  db: Queryable,
  args: { targets: readonly string[]; vantages: readonly string[]; scale: StatusScale; timezone: string; now?: Date },
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
     ), checks as (
       select c.target, c.checked_at, c.outcome, c.latency_ms,
              date_bin(make_interval(secs => $3), c.checked_at at time zone $4, timestamp '2000-01-03') as bucket
       from status_checks c, frame
       where c.target = any($1::text[]) and c.vantage = any($2::text[])
         and c.checked_at >= frame.first_start at time zone $4
         and c.checked_at < (frame.last_start + make_interval(secs => $3)) at time zone $4
     ), minutes as (
       select target, bucket, date_trunc('minute', checked_at) as minute,
              bool_or(outcome <> 'down') as up,
              bool_or(outcome = 'operational') as fast
       from checks group by 1, 2, 3
     ), agg as (
       select target, bucket,
              count(*)::int as total,
              (count(*) filter (where up))::int as up,
              (count(*) filter (where up and not fast))::int as degraded,
              (count(*) filter (where not up))::int as down
       from minutes group by 1, 2
     ), lat as (
       select target, bucket,
              round(avg(latency_ms) filter (where outcome <> 'down'))::int as avg_latency,
              round((percentile_cont(0.95) within group (order by latency_ms) filter (where outcome <> 'down'))::numeric)::int as p95_latency
       from checks group by 1, 2
     )
     select s.target,
            s.bucket at time zone $4 as start,
            (s.bucket + make_interval(secs => $3)) at time zone $4 as "end",
            coalesce(a.total, 0) as total, coalesce(a.up, 0) as up,
            coalesce(a.degraded, 0) as degraded, coalesce(a.down, 0) as down,
            l.avg_latency, l.p95_latency
     from series s
     left join agg a on a.target = s.target and a.bucket = s.bucket
     left join lat l on l.target = s.target and l.bucket = s.bucket
     order by s.target, s.bucket`,
    [args.targets, args.vantages, bucketSeconds, args.timezone, buckets, (args.now ?? new Date()).toISOString()],
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

/**
 * Inserts checks that are not stored yet (same target, vantage and time = the same check), in one
 * statement. Makes syncing idempotent: re-reading a page from DynamoDB adds nothing twice.
 * Returns the number of rows actually inserted.
 */
export async function insertChecksIfMissing(db: Queryable, checks: readonly StatusCheck[]): Promise<number> {
  if (checks.length === 0) return 0;
  const col = <T>(pick: (c: StatusCheck) => T) => checks.map(pick);
  const { rows } = await db.query<{ n: number }>(
    `with t as (
       select * from unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[], $5::int[], $6::int[], $7::bool[], $8::text[], $9::text[])
         as t(target, vantage, checked_at, outcome, http_status, latency_ms, tls_ok, tls_error, error)
     ), ins as (
       insert into status_checks (target, vantage, checked_at, outcome, http_status, latency_ms, tls_ok, tls_error, error)
       select distinct on (t.target, t.vantage, t.checked_at) t.* from t
       where not exists (
         select 1 from status_checks c where c.target = t.target and c.vantage = t.vantage and c.checked_at = t.checked_at
       )
       returning 1
     )
     select count(*)::int as n from ins`,
    [
      col((c) => c.target),
      col((c) => c.vantage),
      col((c) => c.checkedAt),
      col((c) => c.outcome),
      col((c) => c.httpStatus),
      col((c) => c.latencyMs),
      col((c) => c.tlsOk),
      col((c) => c.tlsError),
      col((c) => c.error),
    ],
  );
  return rows[0]?.n ?? 0;
}

/** Newest stored check time of one target from one vantage (the sync cursor after a Redis restart). */
export async function newestCheckAt(db: Queryable, target: string, vantage: string): Promise<Date | null> {
  const { rows } = await db.query<{ at: Date | null }>(
    'select max(checked_at) as at from status_checks where target = $1 and vantage = $2',
    [target, vantage],
  );
  return rows[0]?.at ?? null;
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

export interface IncidentRow {
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
  args: { vantages: readonly string[]; limit: number; names: ReadonlyMap<string, string>; now?: Date },
): Promise<StatusIncident[]> {
  const { rows } = await db.query<IncidentRow>(
    `select id, target, vantage, started_at, resolved_at, failed_checks, last_error
     from status_incidents where vantage = any($1::text[]) order by started_at desc limit $2`,
    [args.vantages, args.limit],
  );
  const now = args.now ?? new Date();
  return rows.map((r) => incidentFromRow(r, args.names, now));
}

/** Incident row (status_incidents) → API shape; open incidents last until `now`. */
export function incidentFromRow(r: IncidentRow, names: ReadonlyMap<string, string>, now: Date): StatusIncident {
  return {
    id: r.id,
    target: r.target,
    targetName: names.get(r.target) ?? r.target,
    vantage: r.vantage,
    startedAt: r.started_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    durationS: Math.max(0, Math.round(((r.resolved_at ?? now).getTime() - r.started_at.getTime()) / 1000)),
    failedChecks: r.failed_checks,
    lastError: r.last_error,
  };
}
