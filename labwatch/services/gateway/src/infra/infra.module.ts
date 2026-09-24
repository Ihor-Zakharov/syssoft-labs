import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createRedis, type DbHandle } from '@labwatch/infra';
import type { Redis } from 'ioredis';
import { CONFIG, loadConfig, type GatewayConfig } from '../config.js';
import { DB, REDIS, REDIS_SUBSCRIBER } from './tokens.js';

@Injectable()
class ConnectionsShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.redis.quit(), this.subscriber.quit(), this.db.pool.end()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: GatewayConfig) => createRedis(config.redisUrl, 'labwatch-gateway'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [CONFIG],
      useFactory: (config: GatewayConfig) => createRedis(config.redisUrl, 'labwatch-gateway-sub'),
    },
    {
      provide: DB,
      inject: [CONFIG],
      // Read-only side: the collector owns the schema and applies migrations
      useFactory: (config: GatewayConfig) => createDb(config.databaseUrl),
    },
    ConnectionsShutdown,
  ],
  exports: [CONFIG, REDIS, REDIS_SUBSCRIBER, DB],
})
export class InfraModule {}
