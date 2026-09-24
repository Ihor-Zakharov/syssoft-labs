import { Module } from '@nestjs/common';
import { GithubService } from './github/github.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { InfraModule } from './infra/infra.module.js';
import { CiPoller } from './pollers/ci.poller.js';
import { CommitsPoller } from './pollers/commits.poller.js';
import { PullsPoller } from './pollers/pulls.poller.js';
import { SourcePoller } from './pollers/source.poller.js';

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [GithubService, HeartbeatService, CiPoller, CommitsPoller, PullsPoller, SourcePoller],
})
export class AppModule {}
