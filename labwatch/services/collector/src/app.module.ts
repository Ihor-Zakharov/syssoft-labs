import { Module } from '@nestjs/common';
import { GithubService } from './github/github.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { InfraModule } from './infra/infra.module.js';
import { AWS_PROBE_READER, IntegrationsService, NotDeployedAwsProbe } from './integrations/integrations.service.js';
import { CiPoller } from './pollers/ci.poller.js';
import { CommitsPoller } from './pollers/commits.poller.js';
import { IntegrationsPoller } from './pollers/integrations.poller.js';
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
    IntegrationsService,
    { provide: AWS_PROBE_READER, useClass: NotDeployedAwsProbe },
    HeartbeatService,
    CiPoller,
    CommitsPoller,
    PullsPoller,
    SyncPoller,
    SourcePoller,
    StatusPoller,
    IntegrationsPoller,
  ],
})
export class AppModule {}
