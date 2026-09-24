import { pageMath, type PageAnchor, type Paged } from '@labwatch/shared';
import type { Queryable } from './status-queries.js';

export interface PageQuery {
  /** Table name — a constant from the caller, never user input. */
  from: string;
  /** Columns to return — a constant from the caller. */
  select: string;
  /** WHERE condition with $1… placeholders for `params`. */
  where: string;
  params: unknown[];
  /** Time column and a unique key column: the total order is (time desc, key desc). */
  timeCol: string;
  keyCol: string;
  /** SQL type of the key, so the anchor compares like the column does (bigint ids sort as numbers). */
  keyType: 'bigint' | 'integer' | 'text';
  page: number;
  pageSize: number;
  /** null on page 1: the newest row becomes the anchor. */
  anchor: PageAnchor | null;
}

/**
 * Keyset-anchored paging: rows are counted from the anchor (the newest row when the reader left
 * page 1), so rows inserted later never shift pages 2…N; `newer` says how many arrived since.
 */
export async function pageQuery<R extends object>(db: Queryable, q: PageQuery): Promise<Paged<R>> {
  const n = q.params.length;
  let anchor = q.anchor;
  if (!anchor) {
    const { rows } = await db.query<{ at: Date; key: string }>(
      `select ${q.timeCol} as at, ${q.keyCol}::text as key from ${q.from} where ${q.where}
       order by ${q.timeCol} desc, ${q.keyCol} desc limit 1`,
      q.params,
    );
    anchor = rows[0] ? { at: new Date(rows[0].at).toISOString(), key: rows[0].key } : null;
  }
  if (!anchor) return { rows: [], total: 0, page: 1, pageSize: q.pageSize, anchor: null, newer: 0 };

  const upTo = `(${q.timeCol}, ${q.keyCol}) <= ($${n + 1}::timestamptz, $${n + 2}::${q.keyType})`;
  const withAnchor = [...q.params, anchor.at, anchor.key];
  const [{ rows: counts }, { rows: newer }] = await Promise.all([
    db.query<{ total: number }>(`select count(*)::int as total from ${q.from} where ${q.where} and ${upTo}`, withAnchor),
    db.query<{ newer: number }>(`select count(*)::int as newer from ${q.from} where ${q.where} and not ${upTo}`, withAnchor),
  ]);
  const total = counts[0]?.total ?? 0;
  const { page, offset } = pageMath(total, q.page, q.pageSize);
  const { rows } = await db.query<R>(
    `select ${q.select} from ${q.from} where ${q.where} and ${upTo}
     order by ${q.timeCol} desc, ${q.keyCol} desc limit $${n + 3} offset $${n + 4}`,
    [...withAnchor, q.pageSize, offset],
  );
  return { rows, total, page, pageSize: q.pageSize, anchor, newer: newer[0]?.newer ?? 0 };
}

/**
 * SQL for "the commit touches this area" (same rules as areaForPath: Lab<N>/ → "Lab N", labwatch/ → Infra,
 * .github/ → CI, anything else → Repo), matched on commit_files. `shaCol` is the commits' sha column,
 * `param` the placeholder number to use for a lab prefix. Unknown areas match nothing.
 */
export function commitAreaCondition(area: string, shaCol: string, param: number): { sql: string; params: unknown[] } {
  const exists = (cond: string) => `exists (select 1 from commit_files f where f.sha = ${shaCol} and ${cond})`;
  const lab = /^Lab (\d+)$/.exec(area);
  if (lab) return { sql: exists(`f.path like $${param}`), params: [`Lab${Number(lab[1])}/%`] };
  if (area === 'Infra') return { sql: exists(`f.path like 'labwatch/%'`), params: [] };
  if (area === 'CI') return { sql: exists(`f.path like '.github/%'`), params: [] };
  if (area === 'Repo') {
    return { sql: exists(`not (f.path ~ '^Lab[0-9]+/' or f.path like 'labwatch/%' or f.path like '.github/%')`), params: [] };
  }
  return { sql: 'false', params: [] };
}
