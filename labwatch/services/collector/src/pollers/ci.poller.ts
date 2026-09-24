import { Inject, Injectable } from '@nestjs/common';
import { ciJobs, ciRuns, type DbHandle } from '@labwatch/infra';
import { RedisKeys, type CiJob, type CiRun, type CiStatus } from '@labwatch/shared';
import { CONFIG, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { excludedColumns } from '../infra/upsert.js';
import { diffCi, type CiState } from '../logic/ci-diff.js';
import { isActiveStatus, MAX_JOB_FETCHES_PER_POLL, nextCiDelay } from '../logic/intervals.js';
import { PollingService } from './polling-service.js';
import { jobRow, runRow } from './rows.js';

@Injectable()
export class CiPoller extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly github: GithubService,
    private readonly store: StatusStore,
  ) {
    super('CiPoller');
  }

  protected async poll(): Promise<number> {
    const wait = this.github.waitMs();
    if (wait > 0) return wait;

    const intervals = this.github.intervals;
    const allRuns: CiRun[] = [];

    for (const repo of this.config.repos) {
      const { data: runs, changed } = await this.github.runs(repo);
      allRuns.push(...runs);
      if (changed && runs.length > 0) {
        await this.db.db
          .insert(ciRuns)
          .values(runs.map(runRow))
          .onConflictDoUpdate({ target: ciRuns.id, set: excludedColumns(ciRuns, ['id']) });
      }

      // Jobs of running workflows change without the runs list changing: fetch them every round (ETag keeps it cheap)
      const jobs: Record<string, CiJob[]> = {};
      let jobsChanged = false;
      if (intervals.fetchJobs) {
        for (const run of runs.filter((r) => isActiveStatus(r.status)).slice(0, MAX_JOB_FETCHES_PER_POLL)) {
          const result = await this.github.jobs(repo, run.id);
          jobs[run.id] = result.data;
          if (result.changed && result.data.length > 0) {
            jobsChanged = true;
            await this.db.db
              .insert(ciJobs)
              .values(result.data.map(jobRow))
              .onConflictDoUpdate({ target: ciJobs.id, set: excludedColumns(ciJobs, ['id']) });
          }
        }
      }

      const status: CiStatus = {
        repo,
        updatedAt: new Date().toISOString(),
        activeRuns: runs.filter((r) => isActiveStatus(r.status)).length,
        runs: runs.slice(0, 20),
        jobs,
      };
      await this.store.setJson(RedisKeys.ciStatus(repo), status);

      if (changed) {
        const previous = await this.store.getJson<CiState>(RedisKeys.ciState(repo));
        const { next, events } = diffCi(previous, runs, new Date());
        await this.store.setJson(RedisKeys.ciState(repo), next);
        await this.store.emit(events);
      }
      if (changed || jobsChanged) await this.store.publish('ci');
    }

    return nextCiDelay(allRuns, intervals);
  }
}
