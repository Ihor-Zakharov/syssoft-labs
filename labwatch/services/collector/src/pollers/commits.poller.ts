import { Inject, Injectable } from '@nestjs/common';
import { branches as branchesTable, type DbHandle } from '@labwatch/infra';
import { CONFIG, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { excludedColumns } from '../infra/upsert.js';
import { SyncService } from '../sync/sync.service.js';
import { PollingService } from './polling-service.js';
import { branchRow } from './rows.js';

/**
 * Polls only the branch list (one request, ETag). Commits, compare and lab discovery are
 * event-driven: the sync service fetches them for branches whose head moved.
 */
@Injectable()
export class CommitsPoller extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly github: GithubService,
    private readonly store: StatusStore,
    private readonly sync: SyncService,
  ) {
    super('CommitsPoller', 2_000);
  }

  protected async poll(): Promise<number> {
    for (const repo of this.config.repos) {
      const branches = await this.github.branches(repo);
      if (branches.changed && branches.data.length > 0) {
        const seenAt = new Date();
        await this.db.db
          .insert(branchesTable)
          .values(branches.data.map((b) => branchRow(b, seenAt)))
          .onConflictDoUpdate({
            target: [branchesTable.repo, branchesTable.name],
            set: excludedColumns(branchesTable, ['repo', 'name']),
          });
      }
      await this.sync.updateHeads(repo, branches.data);
      if (branches.changed) await this.store.publish('commits');
    }
    void this.sync.run();
    return this.github.intervals.commitsMs;
  }
}
