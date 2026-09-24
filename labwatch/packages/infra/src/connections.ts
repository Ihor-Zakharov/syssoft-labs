import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

/**
 * Connection strings can be given directly (DATABASE_URL, REDIS_URL) or built from the same
 * variables docker compose uses (POSTGRES_PASSWORD, REDIS_PASSWORD) — then one .env serves both
 * the containers and `pnpm dev` on the host.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const password = env.POSTGRES_PASSWORD;
  if (!password) throw new Error('Set DATABASE_URL or POSTGRES_PASSWORD');
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const user = env.POSTGRES_USER ?? 'labwatch';
  const db = env.POSTGRES_DB ?? 'labwatch';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

export function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REDIS_URL) return env.REDIS_URL;
  const password = env.REDIS_PASSWORD;
  if (!password) throw new Error('Set REDIS_URL or REDIS_PASSWORD');
  const host = env.REDIS_HOST ?? 'localhost';
  const port = env.REDIS_PORT ?? '6379';
  return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
}

export function createDb(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return { db: drizzle({ client: pool, schema }), pool };
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies pending SQL migrations from packages/infra/drizzle (idempotent). */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}

export function createRedis(url: string, name: string): Redis {
  return new Redis(url, {
    connectionName: name,
    // Keep retrying forever with a capped backoff: Redis restarts must not kill the service
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    maxRetriesPerRequest: 3,
  });
}
