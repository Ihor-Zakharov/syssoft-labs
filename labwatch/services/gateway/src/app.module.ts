import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { InfraModule } from './infra/infra.module.js';
import { RepoService } from './repo.service.js';
import { StatusService } from './status.service.js';
import { UpdatesService } from './updates.service.js';
import { WatchdogService } from './watchdog.service.js';

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [DashboardService, RepoService, StatusService, UpdatesService, WatchdogService, HeartbeatService],
})
export class AppModule {}
