import { Injectable } from '@nestjs/common';
import { GithubService } from '../github/github.service.js';
import { SyncService } from '../sync/sync.service.js';
import { PollingService } from './polling-service.js';

/**
 * Keeps event-driven work moving when the budget was exhausted: a later round picks up where the
 * last one stopped. Costs nothing when there is nothing to do.
 */
@Injectable()
export class SyncPoller extends PollingService {
  constructor(
    private readonly github: GithubService,
    private readonly sync: SyncService,
  ) {
    super('SyncPoller', 10_000);
  }

  protected async poll(): Promise<number> {
    await this.sync.run();
    return this.github.intervals.syncMs;
  }
}
