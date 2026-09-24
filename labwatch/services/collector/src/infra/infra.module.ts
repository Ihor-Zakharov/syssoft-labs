import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createRedis, runMigrations, type DbHandle } from '@labwatch/infra';
import type { Redis } from 'ioredis';
import { CONFIG, loadConfig, type CollectorConfig } from '../config.js';
import { StatusStore } from './status-store.js';
import { DB, REDIS } from './tokens.js';

@Injectable()
class ConnectionsShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.redis.quit(), this.db.pool.end()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: CollectorConfig) => createRedis(config.redisUrl, 'labwatch-collector'),
    },
    {
      provide: DB,
      inject: [CONFIG],
      // The collector owns the schema: it applies migrations before anything polls
      useFactory: async (config: CollectorConfig) => {
        const handle = createDb(config.databaseUrl);
        await runMigrations(handle.db);
        new Logger('Database').log('Migrations applied');
        return handle;
      },
    },
    StatusStore,
    ConnectionsShutdown,
  ],
  exports: [CONFIG, REDIS, DB, StatusStore],
})
export class InfraModule {}
