import { Inject, Injectable } from '@nestjs/common';
import { pullRequests, type DbHandle } from '@labwatch/infra';
import { RedisKeys, type PullsStatus } from '@labwatch/shared';
import { CONFIG, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { excludedColumns } from '../infra/upsert.js';
import { PollingService } from './polling-service.js';
import { pullRow } from './rows.js';

@Injectable()
export class PullsPoller extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly github: GithubService,
    private readonly store: StatusStore,
  ) {
    super('PullsPoller', 4_000);
  }

  protected async poll(): Promise<number> {
    const wait = this.github.waitMs();
    if (wait > 0) return wait;

    for (const repo of this.config.repos) {
      const { data: pulls, changed } = await this.github.pulls(repo);
      if (changed && pulls.length > 0) {
        await this.db.db
          .insert(pullRequests)
          .values(pulls.map(pullRow))
          .onConflictDoUpdate({
            target: [pullRequests.repo, pullRequests.number],
            set: excludedColumns(pullRequests, ['repo', 'number']),
          });
      }
      const status: PullsStatus = { repo, updatedAt: new Date().toISOString(), pulls };
      await this.store.setJson(RedisKeys.pullsStatus(repo), status);
      if (changed) await this.store.publish('pulls');
    }

    return this.github.intervals.pullsMs;
  }
}
