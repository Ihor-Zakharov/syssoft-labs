import { Inject, Injectable } from '@nestjs/common';
import { ciJobs, ciRuns, commitAreaCondition, commits, pageQuery, prComments, prReviews, pullRequests, testReports, type DbHandle } from '@labwatch/infra';
import {
  CommitsStatusSchema,
  RedisKeys,
  ciStateOf,
  pageList,
  type BranchesView,
  type CiJob,
  type CiRun,
  type CiRunDetail,
  type CiRunRow,
  type CommitRow,
  type CommitsStatus,
  type CommitsView,
  type PageArgs,
  type Paged,
  type PrComment,
  type PrReview,
  type PullDetail,
  type PullRequest,
  type PullRow,
  type ReviewState,
  type TestReport,
  type TestTotals,
} from '@labwatch/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { CONFIG, type GatewayConfig } from './config.js';
import { DB, REDIS } from './infra/tokens.js';
import {
  aheadOfMain,
  branchSummaries,
  checksFor,
  commitAreas,
  compareFor,
  findingsOf,
  inMain,
  prForBranch,
  reviewOutcomeFor,
  type PrPosts,
} from './logic/views.js';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());

type RunRecord = typeof ciRuns.$inferSelect;

/** Rows fetched by key, in the order of `keys` (the page order); keys whose row vanished meanwhile are skipped. */
function inKeyOrder<K, R>(keys: readonly K[], rows: readonly R[], keyOf: (row: R) => K): R[] {
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  return keys.flatMap((k) => {
    const row = byKey.get(k);
    return row ? [row] : [];
  });
}

/** Same page with other rows (the page math and the anchor stay). */
function withRows<T, U>(page: Paged<T>, rows: U[]): Paged<U> {
  return { ...page, rows };
}
type PullRecord = typeof pullRequests.$inferSelect;

function toRun(r: RunRecord): CiRun {
  return { ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), runStartedAt: isoOrNull(r.runStartedAt) };
}

function toJob(r: typeof ciJobs.$inferSelect): CiJob {
  return { ...r, startedAt: isoOrNull(r.startedAt), completedAt: isoOrNull(r.completedAt) };
}

function toPull(r: PullRecord): PullRequest {
  return {
    repo: r.repo,
    number: r.number,
    title: r.title,
    state: r.state,
    draft: r.draft,
    merged: r.merged,
    author: r.author,
    headRef: r.headRef,
    headSha: r.headSha,
    baseRef: r.baseRef,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    htmlUrl: r.htmlUrl,
  };
}

function toReport(r: typeof testReports.$inferSelect): TestReport {
  return {
    checkRunId: r.checkRunId,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    htmlUrl: r.htmlUrl,
    headSha: r.headSha,
    completedAt: isoOrNull(r.completedAt),
    parsed: r.parsed,
    title: r.title,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    skipped: r.skipped,
    files: r.files,
    annotations: r.annotations,
  };
}

/** Branches, CI runs, commits and pull requests of the watched repository. */
@Injectable()
export class RepoService {
  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: DbHandle,
  ) {}

  private get repo(): string {
    return this.config.repo;
  }

  async commitsStatus(): Promise<CommitsStatus | null> {
    try {
      const raw = await this.redis.get(RedisKeys.commitsStatus(this.repo));
      const parsed = raw === null ? null : CommitsStatusSchema.safeParse(JSON.parse(raw));
      return parsed?.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async branches(): Promise<BranchesView> {
    const status = await this.commitsStatus();
    if (!status) return { defaultBranch: this.config.defaultBranch, labs: [], branches: [] };
    const heads = status.branches.map((b) => b.headSha);
    const names = status.branches.map((b) => b.name);

    const [headRuns, lastRuns, pulls, findings] = await Promise.all([
      heads.length ? this.db.db.select().from(ciRuns).where(and(eq(ciRuns.repo, this.repo), inArray(ciRuns.headSha, heads))) : [],
      names.length
        ? this.db.db
            .select({ branch: ciRuns.branch, last: sql<Date>`max(${ciRuns.updatedAt})` })
            .from(ciRuns)
            .where(and(eq(ciRuns.repo, this.repo), inArray(ciRuns.branch, names)))
            .groupBy(ciRuns.branch)
        : [],
      this.db.db.select().from(pullRequests).where(eq(pullRequests.repo, this.repo)),
      this.findingsByPr(),
    ]);

    return {
      defaultBranch: status.defaultBranch,
      labs: status.labs,
      branches: branchSummaries({
        status,
        headRuns: headRuns.map(toRun),
        lastRunAt: new Map(lastRuns.filter((r) => r.branch).map((r) => [r.branch!, iso(new Date(r.last))])),
        pulls: pulls.map(toPull),
        findingsByPr: findings,
      }),
    };
  }

  private async findingsByPr(): Promise<Map<number, number>> {
    const { rows } = await this.db.pool.query<{ number: number; findings: number }>(
      `select c.number, count(*)::int as findings
       from pr_comments c join pull_requests p on p.repo = c.repo and p.number = c.number
       where c.repo = $1 and c.kind = 'inline' and c.in_reply_to_id is null and c.author is distinct from p.author
       group by c.number`,
      [this.repo],
    );
    return new Map(rows.map((r) => [r.number, r.findings]));
  }

  // CI runs

  /** Newest first (created_at desc, id desc), 15 per page, anchored so new runs do not shift pages 2…N. */
  async ciRuns(args: { branch: string | null } & PageArgs): Promise<Paged<CiRunRow>> {
    const page = await pageQuery<{ id: string }>(this.db.pool, {
      from: 'ci_runs',
      select: 'id',
      where: args.branch ? 'repo = $1 and branch = $2' : 'repo = $1',
      params: args.branch ? [this.repo, args.branch] : [this.repo],
      timeCol: 'created_at',
      keyCol: 'id',
      keyType: 'bigint',
      page: args.page,
      pageSize: args.pageSize,
      anchor: args.anchor,
    });
    const ids = page.rows.map((r) => Number(r.id));
    const records = ids.length ? await this.db.db.select().from(ciRuns).where(inArray(ciRuns.id, ids)) : [];
    const runs = inKeyOrder(ids, records, (r) => r.id).map(toRun);
    return withRows(page, await this.decorateRuns(runs));
  }

  async ciRun(runId: number): Promise<CiRunDetail | null> {
    const [record] = await this.db.db.select().from(ciRuns).where(eq(ciRuns.id, runId)).limit(1);
    if (!record) return null;
    const [row] = await this.decorateRuns([toRun(record)]);
    const reports = await this.db.db.select().from(testReports).where(eq(testReports.headSha, record.headSha)).orderBy(testReports.name);
    const pulls = (await this.db.db.select().from(pullRequests).where(eq(pullRequests.repo, this.repo))).map(toPull);
    const pr = record.branch ? prForBranch(pulls, record.branch) : null;
    return { run: row!, testReports: reports.map(toReport), pr: pr ? { number: pr.number, htmlUrl: pr.htmlUrl } : null };
  }

  async ciJobs(runId: number): Promise<CiJob[]> {
    return (await this.db.db.select().from(ciJobs).where(eq(ciJobs.runId, runId)).orderBy(sql`${ciJobs.startedAt} nulls last`, ciJobs.id)).map(toJob);
  }

  /** Jobs, test totals of the commit and — for review runs — what the review posted. */
  private async decorateRuns(runs: CiRun[]): Promise<CiRunRow[]> {
    if (runs.length === 0) return [];
    const ids = runs.map((r) => r.id);
    const shas = [...new Set(runs.map((r) => r.headSha))];
    const reviewBranches = [...new Set(runs.filter((r) => r.workflowName === this.config.reviewWorkflow && r.branch).map((r) => r.branch!))];

    const [jobs, totals, pulls] = await Promise.all([
      this.db.db.select().from(ciJobs).where(inArray(ciJobs.runId, ids)).orderBy(sql`${ciJobs.startedAt} nulls last`, ciJobs.id),
      this.db.pool.query<TestTotals & { head_sha: string }>(
        `select head_sha, sum(total)::int as total, sum(passed)::int as passed, sum(failed)::int as failed, sum(skipped)::int as skipped
         from test_reports where head_sha = any($1) and parsed group by head_sha`,
        [shas],
      ),
      reviewBranches.length
        ? this.db.db.select().from(pullRequests).where(and(eq(pullRequests.repo, this.repo), inArray(pullRequests.headRef, reviewBranches)))
        : Promise.resolve([] as PullRecord[]),
    ]);

    const jobsByRun = new Map<number, CiJob[]>();
    for (const job of jobs) jobsByRun.set(job.runId, [...(jobsByRun.get(job.runId) ?? []), toJob(job)]);
    const totalsBySha = new Map(totals.rows.map(({ head_sha, ...t }) => [head_sha, t]));
    const prs = pulls.map(toPull);
    const posts = await this.postsFor(prs);

    return runs.map((run) => {
      let review = null;
      if (run.workflowName === this.config.reviewWorkflow && run.branch) {
        const pr = prForBranch(prs, run.branch);
        review = reviewOutcomeFor(run, pr ? (posts.get(pr.number) ?? null) : null);
      }
      return { ...run, jobs: jobsByRun.get(run.id) ?? [], review, tests: totalsBySha.get(run.headSha) ?? null };
    });
  }

  /** Everything posted on the given PRs (for review outcomes and findings). */
  private async postsFor(prs: readonly PullRequest[]): Promise<Map<number, PrPosts>> {
    const numbers = prs.map((p) => p.number);
    if (numbers.length === 0) return new Map();
    const [comments, reviews] = await Promise.all([
      this.db.db.select().from(prComments).where(and(eq(prComments.repo, this.repo), inArray(prComments.number, numbers))),
      this.db.db.select().from(prReviews).where(and(eq(prReviews.repo, this.repo), inArray(prReviews.number, numbers))),
    ]);
    const result = new Map<number, PrPosts>(prs.map((p) => [p.number, { author: p.author, posts: [], inline: [] }]));
    for (const c of comments) {
      const entry = result.get(c.number)!;
      entry.posts.push({ kind: c.kind as 'inline' | 'issue', author: c.author, createdAt: iso(c.createdAt), inReplyToId: c.inReplyToId });
      if (c.kind === 'inline') entry.inline.push({ author: c.author, inReplyToId: c.inReplyToId, createdAt: iso(c.createdAt) });
    }
    for (const r of reviews) {
      if (r.submittedAt) result.get(r.number)!.posts.push({ kind: 'review', author: r.author, createdAt: iso(r.submittedAt) });
    }
    return result;
  }

  // Commits

  /**
   * Newest first, 15 per page. `area` ("Lab 1", "Infra", "CI", "Repo") keeps only commits whose changed
   * files touch it (commits whose files are not fetched yet drop out while the filter is on).
   */
  async commits(args: { branch: string | null; area: string | null } & PageArgs): Promise<CommitsView> {
    const status = await this.commitsStatus();
    const defaultBranch = status?.defaultBranch ?? this.config.defaultBranch;
    const ahead = aheadOfMain(status);
    const labs = status?.labs ?? [];

    if (args.branch) {
      // A branch's commits come from the collector's snapshot, already newest first
      const branch = status?.branches.find((b) => b.name === args.branch);
      let list = branch?.commits ?? [];
      if (args.area) {
        const areas = await this.pathsBySha(list.map((c) => c.sha));
        list = list.filter((c) => commitAreas(areas.get(c.sha))?.includes(args.area!));
      }
      const page = pageList(list, args, (c) => c.sha, (c) => c.committedAt);
      const shas = page.rows.map((c) => c.sha);
      const [areas, seen] = await Promise.all([this.pathsBySha(shas), this.branchesBySha(shas)]);
      const isDefault = args.branch === defaultBranch;
      const compare = branch ? compareFor(branch) : null;
      const rows: CommitRow[] = page.rows.map((c) => ({
        ...c,
        branches: seen.get(c.sha) ?? [args.branch!],
        areas: commitAreas(areas.get(c.sha)),
        inMain: isDefault ? true : compare ? !compare.aheadShas.includes(c.sha) : null,
      }));
      return { branch: args.branch, defaultBranch, compare, labs, commits: withRows(page, rows) };
    }

    const area = args.area ? commitAreaCondition(args.area, 'commits.sha', 2) : null;
    const page = await pageQuery<{ sha: string }>(this.db.pool, {
      from: 'commits',
      select: 'sha',
      where: area ? `repo = $1 and ${area.sql}` : 'repo = $1',
      params: [this.repo, ...(area?.params ?? [])],
      timeCol: 'committed_at',
      keyCol: 'sha',
      keyType: 'text',
      page: args.page,
      pageSize: args.pageSize,
      anchor: args.anchor,
    });
    const shas = page.rows.map((r) => r.sha);
    const records = shas.length ? await this.db.db.select().from(commits).where(inArray(commits.sha, shas)) : [];
    const [areas, seen] = await Promise.all([this.pathsBySha(shas), this.branchesBySha(shas)]);
    const rows: CommitRow[] = inKeyOrder(shas, records, (c) => c.sha).map((c) => {
      const on = seen.get(c.sha) ?? [];
      return { ...c, committedAt: iso(c.committedAt), branches: on, areas: commitAreas(areas.get(c.sha)), inMain: inMain(c.sha, on, defaultBranch, ahead) };
    });
    return { branch: null, defaultBranch, compare: null, labs, commits: withRows(page, rows) };
  }

  /** Changed paths per commit; commits whose files were not fetched yet are missing from the map. */
  private async pathsBySha(shas: string[]): Promise<Map<string, string[]>> {
    if (shas.length === 0) return new Map();
    const { rows } = await this.db.pool.query<{ sha: string; paths: string[] }>(
      `select d.sha, coalesce(array_agg(f.path) filter (where f.path is not null), '{}') as paths
       from commit_details d left join commit_files f on f.sha = d.sha
       where d.sha = any($1) group by d.sha`,
      [shas],
    );
    return new Map(rows.map((r) => [r.sha, r.paths]));
  }

  private async branchesBySha(shas: string[]): Promise<Map<string, string[]>> {
    if (shas.length === 0) return new Map();
    const status = await this.commitsStatus();
    const live = new Set(status?.branches.map((b) => b.name) ?? []);
    const { rows } = await this.db.pool.query<{ sha: string; branches: string[] }>(
      `select sha, array_agg(branch order by branch) as branches from branch_commits where repo = $1 and sha = any($2) group by sha`,
      [this.repo, shas],
    );
    // Deleted branches are not interesting any more
    return new Map(rows.map((r) => [r.sha, r.branches.filter((b) => live.size === 0 || live.has(b))]));
  }

  // Pull requests

  /** Most recently updated first (updated_at desc, number desc), 15 per page. */
  async pulls(args: { branch: string | null } & PageArgs): Promise<Paged<PullRow>> {
    const page = await pageQuery<{ number: number }>(this.db.pool, {
      from: 'pull_requests',
      select: 'number',
      where: args.branch ? 'repo = $1 and head_ref = $2' : 'repo = $1',
      params: args.branch ? [this.repo, args.branch] : [this.repo],
      timeCol: 'updated_at',
      keyCol: 'number',
      keyType: 'integer',
      page: args.page,
      pageSize: args.pageSize,
      anchor: args.anchor,
    });
    const numbers = page.rows.map((r) => r.number);
    const records = numbers.length
      ? await this.db.db.select().from(pullRequests).where(and(eq(pullRequests.repo, this.repo), inArray(pullRequests.number, numbers)))
      : [];
    return withRows(page, await this.decoratePulls(inKeyOrder(numbers, records, (p) => p.number)));
  }

  async pull(number: number): Promise<PullDetail | null> {
    const records = await this.db.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repo, this.repo), eq(pullRequests.number, number)))
      .limit(1);
    if (records.length === 0) return null;
    const [row] = await this.decoratePulls(records);
    const [reviews, comments] = await Promise.all([
      this.db.db
        .select()
        .from(prReviews)
        .where(and(eq(prReviews.repo, this.repo), eq(prReviews.number, number)))
        .orderBy(sql`${prReviews.submittedAt} nulls last`),
      this.db.db
        .select()
        .from(prComments)
        .where(and(eq(prComments.repo, this.repo), eq(prComments.number, number)))
        .orderBy(prComments.createdAt),
    ]);
    return {
      pull: row!,
      reviews: reviews.map(
        (r): PrReview => ({ id: r.id, author: r.author, state: r.state, body: r.body, submittedAt: isoOrNull(r.submittedAt), htmlUrl: r.htmlUrl }),
      ),
      comments: comments.map(
        (c): PrComment => ({
          id: c.id,
          kind: c.kind as PrComment['kind'],
          author: c.author,
          path: c.path,
          line: c.line,
          body: c.body,
          createdAt: iso(c.createdAt),
          htmlUrl: c.htmlUrl,
          inReplyToId: c.inReplyToId,
        }),
      ),
    };
  }

  private async decoratePulls(records: PullRecord[]): Promise<PullRow[]> {
    if (records.length === 0) return [];
    const pulls = records.map(toPull);
    const status = await this.commitsStatus();
    const heads = new Map(status?.branches.map((b) => [b.name, b.headSha]) ?? []);
    const shaOf = (p: PullRequest) => p.headSha ?? heads.get(p.headRef) ?? null;
    const shas = [...new Set(pulls.map(shaOf).filter((s): s is string => s !== null))];
    const branches = [...new Set(pulls.map((p) => p.headRef))];

    const [runs, reviewRuns, posts] = await Promise.all([
      shas.length ? this.db.db.select().from(ciRuns).where(and(eq(ciRuns.repo, this.repo), inArray(ciRuns.headSha, shas))) : [],
      this.db.db
        .select()
        .from(ciRuns)
        .where(and(eq(ciRuns.repo, this.repo), eq(ciRuns.workflowName, this.config.reviewWorkflow), inArray(ciRuns.branch, branches)))
        .orderBy(desc(ciRuns.runNumber), desc(ciRuns.runAttempt)),
      this.postsFor(pulls),
    ]);
    const allRuns = runs.map(toRun);

    return records.map((record, i) => {
      const pull = pulls[i]!;
      const sha = shaOf(pull);
      const mine = allRuns.filter((r) => r.headSha === sha);
      const prPosts = posts.get(pull.number) ?? null;
      const lastReviewRun = reviewRuns.find((r) => r.branch === pull.headRef);
      return {
        ...pull,
        reviewState: (record.reviewState ?? 'none') as ReviewState,
        findings: prPosts ? findingsOf(prPosts) : 0,
        areas: record.areas,
        checks: checksFor(mine),
        ciState: ciStateOf(mine),
        lastReview: lastReviewRun ? reviewOutcomeFor(toRun(lastReviewRun), prPosts) : null,
      };
    });
  }
}
