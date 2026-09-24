import {
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { startHeartbeat, type DbHandle } from '@labwatch/infra';
import type { Redis } from 'ioredis';
import { VERSION } from './config.js';
import { DB, REDIS } from './infra/tokens.js';

@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private stop: (() => void) | undefined;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationBootstrap(): void {
    this.stop = startHeartbeat(this.redis, 'collector', VERSION, (e) =>
      this.logger.warn(`Heartbeat failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  onModuleDestroy(): void {
    this.stop?.();
  }
}

/** Liveness/readiness for docker healthchecks: 200 only when both stores answer. */
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  @Get('health')
  async health() {
    const [redis, postgres] = await Promise.all([
      this.redis.ping().then(() => true, () => false),
      this.db.pool.query('select 1').then(() => true, () => false),
    ]);
    const body = {
      service: 'collector',
      version: VERSION,
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
      redis,
      postgres,
    };
    if (!redis || !postgres) throw new ServiceUnavailableException(body);
    return { status: 'ok', ...body };
  }
}
