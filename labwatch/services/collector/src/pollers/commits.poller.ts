import { Inject, Injectable } from '@nestjs/common';
import { branches as branchesTable, commits as commitsTable, type DbHandle } from '@labwatch/infra';
import { RedisKeys, type Commit, type CommitsStatus } from '@labwatch/shared';
import { CONFIG, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { excludedColumns } from '../infra/upsert.js';
import { pickBranches } from '../logic/github-map.js';
import { PollingService } from './polling-service.js';
import { branchRow, commitRow } from './rows.js';

@Injectable()
export class CommitsPoller extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly github: GithubService,
    private readonly store: StatusStore,
  ) {
    super('CommitsPoller', 2_000);
  }

  protected async poll(): Promise<number> {
    const wait = this.github.waitMs();
    if (wait > 0) return wait;
    const intervals = this.github.intervals;

    for (const repo of this.config.repos) {
      const branches = await this.github.branches(repo);
      let changed = branches.changed;
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

      const bySha = new Map<string, Commit>();
      for (const branch of pickBranches(branches.data, this.config.defaultBranch, intervals.maxBranches)) {
        const result = await this.github.commits(repo, branch.name);
        for (const commit of result.data) bySha.set(commit.sha, commit);
        if (result.changed && result.data.length > 0) {
          changed = true;
          await this.db.db
            .insert(commitsTable)
            .values(result.data.map(commitRow))
            .onConflictDoUpdate({ target: commitsTable.sha, set: excludedColumns(commitsTable, ['sha']) });
        }
      }

      const status: CommitsStatus = {
        repo,
        updatedAt: new Date().toISOString(),
        branches: branches.data,
        commits: [...bySha.values()].sort((a, b) => b.committedAt.localeCompare(a.committedAt)).slice(0, 30),
      };
      await this.store.setJson(RedisKeys.commitsStatus(repo), status);
      if (changed) await this.store.publish('commits');
    }

    return intervals.commitsMs;
  }
}
