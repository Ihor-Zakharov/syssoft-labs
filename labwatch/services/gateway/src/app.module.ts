import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { InfraModule } from './infra/infra.module.js';
import { UpdatesService } from './updates.service.js';
import { WatchdogService } from './watchdog.service.js';

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [DashboardService, UpdatesService, WatchdogService, HeartbeatService],
})
export class AppModule {}
