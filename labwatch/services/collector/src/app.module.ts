import { Module } from '@nestjs/common';
import { AwsStatusSync, createDynamoClient, DYNAMO, DynamoAwsProbeReader } from './aws/aws-status.js';
import { CONFIG, type CollectorConfig } from './config.js';
import { GithubService } from './github/github.service.js';
import { HealthController, HeartbeatService } from './health.js';
import { IncidentTracker } from './infra/incidents.js';
import { InfraModule } from './infra/infra.module.js';
import { AWS_PROBE_READER, IntegrationsService, NoReadKeyAwsProbe } from './integrations/integrations.service.js';
import type { QueryClient } from './logic/aws-status.js';
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
    IncidentTracker,
    { provide: DYNAMO, inject: [CONFIG], useFactory: createDynamoClient },
    {
      // With the reader's key in .env the AWS card reads DynamoDB; without it, it explains what is missing
      provide: AWS_PROBE_READER,
      inject: [DYNAMO, CONFIG],
      useFactory: (client: QueryClient | null, config: CollectorConfig) => (client ? new DynamoAwsProbeReader(client, config.aws) : new NoReadKeyAwsProbe()),
    },
    AwsStatusSync,
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
