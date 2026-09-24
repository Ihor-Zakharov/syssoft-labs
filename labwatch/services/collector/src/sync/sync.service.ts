import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  branchCommits,
  checkRunsFetched,
  ciJobs,
  ciJobsFetched,
  commitDetails,
  commitFiles,
  commits as commitsTable,
  prComments,
  prReviews,
  pullRequests,
  testReports,
  type DbHandle,
} from '@labwatch/infra';
import {
  RedisKeys,
  aggregateReviewState,
  type Branch,
  type BranchState,
  type CommitsStatus,
  type TestAnnotation,
  type UpdateTopic,
} from '@labwatch/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { CONFIG, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { excludedColumns } from '../infra/upsert.js';
import { BudgetExceededError } from '../logic/budget.js';
import { GithubHttpError } from '../logic/etag-client.js';
import { isTestReportCheckRun, parseTestSummary } from '../logic/test-report.js';
import { commitRow, jobRow } from '../pollers/rows.js';

/** Items that failed with a non-budget error are skipped for a while instead of being retried every round. */
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Event-driven GitHub work, in priority order: reviews → commits → checks → backfill. Each call
 * needs a budget slot; when the budget of a priority is used up, BudgetExceededError ends the
 * round (lower priorities have smaller shares, so they would be refused too) and the work simply
 * continues in a later round. Everything is idempotent and stored as it goes.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private running: Promise<void> | null = null;
  private queued = false;
  /** Serialises everything that reads and rewrites status:commits. */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly failedUntil = new Map<string, number>();

  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly github: GithubService,
    private readonly store: StatusStore,
  ) {}

  /** Runs one round; calls while a round is running are coalesced into one follow-up round. */
  run(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.withLock(() => this.round())
      .catch((error: unknown) => this.logger.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.running = null;
        if (this.queued) {
          this.queued = false;
          void this.run();
        }
      });
    return this.running;
  }

  /** Records the branch heads from the periodic branch poll (keeps fetched commits/compare of unchanged branches). */
  async updateHeads(repo: string, branches: Branch[]): Promise<void> {
    await this.withLock(async () => {
      const previous = await this.store.getJson<CommitsStatus>(RedisKeys.commitsStatus(repo));
      const byName = new Map((previous?.branches ?? []).map((b) => [b.name, b]));
      const next: BranchState[] = branches.map((b) => {
        const known = byName.get(b.name);
        return { ...b, commitsSha: known?.commitsSha ?? null, commits: known?.commits ?? [], compare: known?.compare ?? null };
      });
      await this.writeStatus({
        repo,
        updatedAt: new Date().toISOString(),
        defaultBranch: this.config.defaultBranch,
        labs: previous?.labs ?? [],
        labsSha: previous?.labsSha ?? null,
        branches: next,
      });
    });
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async round(): Promise<void> {
    for (const repo of this.config.repos) {
      const topics = new Set<UpdateTopic>();
      try {
        await this.syncReviews(repo, topics);
        await this.syncBranches(repo, topics);
        await this.syncChecks(repo, topics);
        await this.syncBackfill(repo, topics);
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
      } finally {
        for (const topic of topics) await this.store.publish(topic);
      }
    }
  }

  private skip(key: string): boolean {
    const until = this.failedUntil.get(key);
    return until !== undefined && until > Date.now();
  }

  /** Runs one item; GitHub errors (404 for a deleted branch, 422, …) back the item off instead of failing the round. */
  private async attempt(key: string, fn: () => Promise<void>): Promise<void> {
    if (this.skip(key)) return;
    try {
      await fn();
      this.failedUntil.delete(key);
    } catch (error) {
      if (error instanceof GithubHttpError) {
        this.logger.warn(`${key}: ${error.message}`);
        this.failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
        return;
      }
      throw error;
    }
  }

  // 1. Reviews: reviews, inline and conversation comments of PRs that changed since the last fetch
  private async syncReviews(repo: string, topics: Set<UpdateTopic>): Promise<void> {
    const pending = await this.db.db
      .select({ number: pullRequests.number, updatedAt: pullRequests.updatedAt })
      .from(pullRequests)
      .where(and(eq(pullRequests.repo, repo), sql`(${pullRequests.reviewedAt} is null or ${pullRequests.reviewedAt} < ${pullRequests.updatedAt})`))
      .orderBy(sql`${pullRequests.updatedAt} desc`)
      .limit(20);

    for (const pr of pending) {
      await this.attempt(`reviews:${repo}#${pr.number}`, async () => {
        const reviews = (await this.github.reviews(repo, pr.number)).data;
        const inline = (await this.github.reviewComments(repo, pr.number)).data;
        const issue = (await this.github.issueComments(repo, pr.number)).data;
        const comments = [...inline, ...issue];

        await this.db.db.transaction(async (tx) => {
          if (reviews.length > 0) {
            await tx
              .insert(prReviews)
              .values(reviews.map((r) => ({ ...r, repo, number: pr.number, submittedAt: r.submittedAt ? new Date(r.submittedAt) : null })))
              .onConflictDoUpdate({ target: prReviews.id, set: excludedColumns(prReviews, ['id']) });
          }
          // Deleted comments disappear from the API: drop them here too
          await tx
            .delete(prComments)
            .where(
              and(
                eq(prComments.repo, repo),
                eq(prComments.number, pr.number),
                comments.length > 0 ? notInArray(prComments.id, comments.map((c) => c.id)) : undefined,
              ),
            );
          if (comments.length > 0) {
            await tx
              .insert(prComments)
              .values(
                comments.map((c) => ({
                  ...c,
                  repo,
                  number: pr.number,
                  createdAt: new Date(c.createdAt),
                  updatedAt: new Date(c.createdAt),
                })),
              )
              .onConflictDoUpdate({ target: prComments.id, set: excludedColumns(prComments, ['id']) });
          }
          await tx
            .update(pullRequests)
            .set({ reviewState: aggregateReviewState(reviews), reviewedAt: pr.updatedAt })
            .where(and(eq(pullRequests.repo, repo), eq(pullRequests.number, pr.number)));
        });
        topics.add('reviews');
      });
    }
  }

  // 2. Commits: lab discovery on the default branch, recent commits of every branch whose head moved
  private async syncBranches(repo: string, topics: Set<UpdateTopic>): Promise<void> {
    const status = await this.store.getJson<CommitsStatus>(RedisKeys.commitsStatus(repo));
    if (!status) return;
    let dirty = false;
    try {
      const main = status.branches.find((b) => b.name === status.defaultBranch);
      if (main && status.labsSha !== main.headSha) {
        await this.attempt(`labs:${repo}`, async () => {
          status.labs = (await this.github.labs(repo, main.headSha)).data;
          status.labsSha = main.headSha;
          dirty = true;
          topics.add('commits');
        });
      }

      // Default branch first: "not in main" marks depend on it
      const ordered = [...status.branches].sort((a, b) => Number(b.name === status.defaultBranch) - Number(a.name === status.defaultBranch));
      for (const branch of ordered.slice(0, this.github.intervals.maxBranches)) {
        if (branch.commitsSha === branch.headSha) continue;
        await this.attempt(`commits:${repo}:${branch.name}`, async () => {
          const result = await this.github.commits(repo, branch.name);
          branch.commits = result.data;
          branch.commitsSha = branch.headSha;
          dirty = true;
          topics.add('commits');
          if (result.data.length === 0) return;
          await this.db.db
            .insert(commitsTable)
            .values(result.data.map(commitRow))
            .onConflictDoUpdate({ target: commitsTable.sha, set: excludedColumns(commitsTable, ['sha']) });
          const seenAt = new Date();
          await this.db.db
            .insert(branchCommits)
            .values(result.data.map((c) => ({ repo, branch: branch.name, sha: c.sha, seenAt })))
            .onConflictDoNothing();
        });
      }
    } finally {
      if (dirty) await this.writeStatus(status);
    }
  }

  // 3. Checks: test reports of finished commits, final jobs (with steps) of finished runs
  private async syncChecks(repo: string, topics: Set<UpdateTopic>): Promise<void> {
    const { rows: shas } = await this.db.pool.query<{ head_sha: string }>(
      `select r.head_sha from ci_runs r
       where r.repo = $1 and r.created_at > now() - interval '14 days'
         and not exists (select 1 from check_runs_fetched f where f.repo = r.repo and f.head_sha = r.head_sha
                         and (f.complete or f.fetched_at > now() - interval '5 minutes'))
       group by r.head_sha having bool_and(r.status = 'completed')
       order by max(r.updated_at) desc limit 10`,
      [repo],
    );
    for (const { head_sha: sha } of shas) {
      await this.attempt(`checks:${repo}:${sha}`, async () => {
        const runs = (await this.github.checkRuns(repo, sha)).data;
        for (const run of runs) {
          if (!isTestReportCheckRun({ name: run.name, summary: run.output.summary }, this.config.testReportPattern)) continue;
          const summary = parseTestSummary(run.output.summary);
          let annotations: TestAnnotation[] = [];
          if (run.output.annotations_count > 0 && run.status === 'completed') {
            annotations = (await this.github.annotations(repo, run.id)).data;
          }
          const row = {
            checkRunId: run.id,
            repo,
            headSha: sha,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            htmlUrl: run.html_url,
            completedAt: run.completed_at ? new Date(run.completed_at) : null,
            title: run.output.title,
            parsed: summary.parsed,
            total: summary.total,
            passed: summary.passed,
            failed: summary.failed,
            skipped: summary.skipped,
            files: summary.files,
            annotations,
          };
          await this.db.db
            .insert(testReports)
            .values(row)
            .onConflictDoUpdate({ target: testReports.checkRunId, set: excludedColumns(testReports, ['checkRunId']) });
          topics.add('checks');
        }
        const complete = runs.every((r) => r.status === 'completed');
        await this.db.db
          .insert(checkRunsFetched)
          .values({ repo, headSha: sha, fetchedAt: new Date(), complete })
          .onConflictDoUpdate({ target: [checkRunsFetched.repo, checkRunsFetched.headSha], set: { fetchedAt: new Date(), complete } });
      });
    }

    const { rows: runs } = await this.db.pool.query<{ id: string }>(
      `select r.id from ci_runs r
       where r.repo = $1 and r.status = 'completed' and r.created_at > now() - interval '14 days'
         and not exists (select 1 from ci_jobs_fetched f where f.run_id = r.id)
       order by r.created_at desc limit 10`,
      [repo],
    );
    for (const { id } of runs) {
      const runId = Number(id);
      await this.attempt(`jobs:${runId}`, async () => {
        const jobs = (await this.github.jobs(repo, runId, 'checks')).data;
        if (jobs.length > 0) {
          await this.db.db
            .insert(ciJobs)
            .values(jobs.map(jobRow))
            .onConflictDoUpdate({ target: ciJobs.id, set: excludedColumns(ciJobs, ['id']) });
        }
        await this.db.db.insert(ciJobsFetched).values({ runId, fetchedAt: new Date() }).onConflictDoNothing();
        topics.add('ci');
      });
    }
  }

  // 4. Backfill: ahead/behind + touched areas per branch and PR, changed files of every commit
  private async syncBackfill(repo: string, topics: Set<UpdateTopic>): Promise<void> {
    const status = await this.store.getJson<CommitsStatus>(RedisKeys.commitsStatus(repo));
    let dirty = false;
    try {
      const main = status?.branches.find((b) => b.name === status.defaultBranch);
      if (status && main) {
        for (const branch of status.branches) {
          if (branch.name === main.name) continue;
          if (branch.compare?.headSha === branch.headSha && branch.compare.baseSha === main.headSha) continue;
          await this.attempt(`compare:${repo}:${branch.name}@${branch.headSha}`, async () => {
            branch.compare = (await this.github.compare(repo, { name: main.name, sha: main.headSha }, { name: branch.name, sha: branch.headSha })).data;
            dirty = true;
            topics.add('commits');
          });
        }
        await this.syncPullAreas(repo, status, topics);
      }
    } finally {
      if (status && dirty) await this.writeStatus(status);
    }

    const { rows } = await this.db.pool.query<{ sha: string }>(
      `select c.sha from commits c
       where c.repo = $1 and not exists (select 1 from commit_details d where d.sha = c.sha)
       order by c.committed_at desc limit 20`,
      [repo],
    );
    for (const { sha } of rows) {
      await this.attempt(`files:${sha}`, async () => {
        const { files, truncated } = (await this.github.commitFiles(repo, sha)).data;
        await this.db.db.transaction(async (tx) => {
          if (files.length > 0) await tx.insert(commitFiles).values(files.map((f) => ({ sha, ...f }))).onConflictDoNothing();
          await tx.insert(commitDetails).values({ sha, repo, fetchedAt: new Date(), fileCount: files.length, truncated }).onConflictDoNothing();
        });
        topics.add('commits');
      });
    }
  }

  /** Areas touched by each open PR: from the branch compare when the base is the default branch, else an own compare. */
  private async syncPullAreas(repo: string, status: CommitsStatus, topics: Set<UpdateTopic>): Promise<void> {
    const heads = new Map(status.branches.map((b) => [b.name, b]));
    const open = await this.db.db
      .select({ number: pullRequests.number, baseRef: pullRequests.baseRef, headRef: pullRequests.headRef, areasHeadSha: pullRequests.areasHeadSha })
      .from(pullRequests)
      .where(and(eq(pullRequests.repo, repo), eq(pullRequests.state, 'open')));

    for (const pr of open) {
      const head = heads.get(pr.headRef);
      const base = heads.get(pr.baseRef);
      if (!head || !base) continue;
      const key = `${base.headSha}...${head.headSha}`;
      if (pr.areasHeadSha === key) continue;
      await this.attempt(`pr-areas:${repo}#${pr.number}@${key}`, async () => {
        const fromBranch = pr.baseRef === status.defaultBranch && head.compare?.baseSha === base.headSha && head.compare.headSha === head.headSha;
        const areas = fromBranch
          ? head.compare!.areas
          : (await this.github.compare(repo, { name: base.name, sha: base.headSha }, { name: head.name, sha: head.headSha })).data.areas;
        await this.db.db
          .update(pullRequests)
          .set({ areas, areasHeadSha: key })
          .where(and(eq(pullRequests.repo, repo), eq(pullRequests.number, pr.number)));
        topics.add('pulls');
      });
    }
  }

  private async writeStatus(status: CommitsStatus): Promise<void> {
    await this.store.setJson(RedisKeys.commitsStatus(status.repo), { ...status, updatedAt: new Date().toISOString() });
  }
}
