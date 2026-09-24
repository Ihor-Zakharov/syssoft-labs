import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * SET clause for INSERT ... ON CONFLICT DO UPDATE that takes every column from the row being
 * inserted (the "excluded" pseudo-table), except the given keys (usually the primary key).
 */
export function excludedColumns<T extends PgTable>(table: T, except: ReadonlyArray<keyof T['_']['columns']>): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (except.includes(key as keyof T['_']['columns'])) continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}
