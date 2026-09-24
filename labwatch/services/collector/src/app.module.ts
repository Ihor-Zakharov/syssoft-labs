import { Module } from '@nestjs/common';
import { GithubService } from './github/github.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { InfraModule } from './infra/infra.module.js';
import { CiPoller } from './pollers/ci.poller.js';
import { CommitsPoller } from './pollers/commits.poller.js';
import { PullsPoller } from './pollers/pulls.poller.js';
import { SourcePoller } from './pollers/source.poller.js';
import { StatusPoller } from './pollers/status.poller.js';
import { SyncPoller } from './pollers/sync.poller.js';
import { SyncService } from './sync/sync.service.js';

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [
    GithubService,
    SyncService,
    HeartbeatService,
    CiPoller,
    CommitsPoller,
    PullsPoller,
    SyncPoller,
    SourcePoller,
    StatusPoller,
  ],
})
export class AppModule {}
