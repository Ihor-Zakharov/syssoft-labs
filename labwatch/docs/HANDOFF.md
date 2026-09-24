# labwatch — handoff: state on 2026-09-24 and how to finish

This document is the single entry point for continuing labwatch after the building agent was stopped.
Everything below is **local** (nothing pushed); GitHub still has only PR #5 (`labwatch`, phase 1).

## 1. Branches

| Branch | Commit | State |
|---|---|---|
| `labwatch` | `d636fa5` | phase 1 — pushed as PR #5 |
| `labwatch-tabs` | `7d8fa33` + this doc | **last green state**: typecheck/test/build pass. Two-level tabs, System/Repository, integrations, review + CI details, Status page (home vantage), GitHub budget limiter, 401 fallback |
| `labwatch-wip` | `8a71122` | parked work of the stopped agent — only the **semantic search** part is still relevant (pagination and the Status tab were redone on `labwatch-tabs`) |

The AWS part lives in a separate worktree: `~/projects/syssoft-labs-infra` (branch `infra-aws`, commits `1807cf5`
bootstrap, `cc4a447` status stack) — see `infra/aws/README.md` there. Both AWS stacks are **applied and running**.

## 2. Run it

```bash
cd ~/projects/syssoft-labs/labwatch
docker compose up -d --build        # postgres, redis, collector, gateway, web
docker compose ps                   # all healthy
```

Dashboard: <http://localhost:8080> (also from Windows — WSL mirrored networking). Postgres `127.0.0.1:5432`,
Redis `127.0.0.1:6379` (passwords in `.env`).

### `.env` (git-ignored, never committed, never printed)

| Variable | Needed for | State |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | the stack | set |
| `GITHUB_TOKEN` | 5000 req/h instead of 60 (fine-grained PAT, *Public repositories*, no permissions) | set (rotated on 2026-09-24 after an exposure in an agent log) |
| `HCP_TERRAFORM_TOKEN` (+ `HCP_TERRAFORM_ORG`, default `zakharov-syssoft`) | Integrations → HCP Terraform card | set (organization token) → Connected, 2 workspaces |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=eu-central-1` | reading the AWS prober (IAM user `syssoft-labs-labwatch-reader`, DynamoDB read-only on one table) | set → AWS card Connected, AWS checks synced into Postgres |

Secret handling rules (after the incident): never `cat`/`grep`/diff `.env`, `~/.aws`, `~/.terraform.d`; check
presence only (`grep -c '^NAME=.\+' .env`); scan only `git diff --cached` before committing.

## 3. Architecture (as on `labwatch-tabs`)

```
GitHub API ──ETag, budget──►  collector (NestJS) ──► Postgres (history)   ◄── gateway (NestJS + tRPC) ◄── web (React/Vite, nginx :8080)
4 KNU sites ──every 60 s──►       │               └► Redis (state, streams) ◄─┘   SSE subscription ────────┘
manual.txt ──every 5 min──►       └─ heartbeat ► Redis (TTL)   watchdog in gateway → service.down/up events
vendor status pages (GitHub, HashiCorp, AWS Health) ──every 5 min──► collector → integrations state
```

- **Postgres tables**: `ci_runs`, `ci_jobs`, `ci_jobs_fetched`, `commits`, `commit_details` (files → area badges),
  `branches`, `pull_requests`, reviews/comments, `source_probes`, `status_checks` (every site check, 120-day retention),
  incidents, `events`. Migrations: `packages/infra/drizzle`.
- **Redis**: `state:*` / `status:*` current state, `health:<service>` heartbeat with TTL, `github:ratelimit`,
  `github:budget`, `github:requests:{token,anonymous}` (rolling-hour limiter), `events` stream, `updates` pub/sub.
- **GitHub budget**: ≤ 40 req/h without a token (leaves 20 of the 60/IP for manual demos), ≤ 2000/h with a token;
  priority ci > reviews > commits > checks > backfill; falls back to anonymous mode on 401.
- **Key env** (collector): `GITHUB_REPOS`, `GITHUB_*_BUDGET_PER_HOUR`, `STATUS_INTERVAL_S` (60), `STATUS_TIMEOUT_MS`
  (10000), `STATUS_DEGRADED_MS` (2000), `STATUS_RETENTION_DAYS` (120), `STATUS_VANTAGE` (`home`),
  `SOURCE_URL`, `SOURCE_EXPECTED_BODY_SHA256`, `SOURCE_EXPECTED_CERT_SHA256`, `INTEGRATIONS_INTERVAL_S`,
  `TEST_REPORT_CHECK_PATTERN`. Gateway: `REVIEW_WORKFLOW`, `STATUS_TIMEZONE` (Europe/Kyiv).

## 4. Done (on `labwatch-tabs`)

- Top tabs `System | Repository | Status`; Repository = `CI runs | Commits | Pull requests` + branch row
  (`Overview`, `main`, branches by activity, merged/idle → `…`), hash routing (`#system`, `#repo/ci/overview`,
  `#status/24h`; `#repo/status/…` redirects),
  no layout shift (verified with bounding-box checks at 1400/1024/760 px).
- CI run details (jobs, steps, logs link, test report from a `dorny/test-reporter` check run — **no such check
  exists yet**, see §6), review results (claude[bot] inline comments, findings count, "review ran, no comments").
- Commits with area badges from changed paths (`Lab N`, `CI`, `Infra`, `Repo`), ahead/behind main.
- Status page with two vantages (Home + AWS Frankfurt): combined banner (a site down from one vantage only →
  Partial Outage), vantage selector, per-vantage latency, 1h/24h/7d/30d/90d bars counting minutes (up if any
  vantage got an answer), incidents per vantage, TLS chip.
- AWS: `DynamoAwsProbeReader` (card: Connected < 3 min, Degraded 3–10 min, Unreachable, Auth error) and
  `AwsStatusSync` (DynamoDB → `status_checks`, incremental, idempotent, throttling backoff) — `services/collector/src/aws`.
- Integrations: GitHub, AWS and HCP Terraform all Connected with the keys in `.env`.
- 151 tests (vitest; 7 SQL tests need a Postgres, e.g. `DATABASE_URL=… pnpm --filter @labwatch/infra test`).

## 5. Unfinished work (`labwatch-wip`) — how to finish

Start with `git switch labwatch-wip` (or cherry-pick parts onto `labwatch-tabs`).

### 5.1 Status as a third top-level tab — **done** on `labwatch-tabs` (`2abafe9`)

### 5.2 Pagination — **done** on `labwatch-tabs` (15 rows per page)

Implemented fresh (only the page math was taken from `labwatch-wip`, no search code):
`packages/shared/src/paging.ts` (`PAGE_SIZE = 15`, `PageArgs`, `Paged<T>`, `pageMath`, `pagerItems`, `pageList` for
in-memory lists), `packages/infra/src/paging.ts` (`pageQuery`: keyset-anchored SQL paging with a typed key, so bigint
run ids compare as numbers; `commitAreaCondition` for the server-side area filter), gateway procedures `ciRuns`,
`commits` (+ `area`), `pulls`, `events` (now from Postgres), `incidents` take `{ page, pageSize, anchor }`, web
`components/Pager.tsx` (`Pager`, `NewerNotice`, `usePageAnchor`, `useRememberAnchor`) and `?page=N` in the hash.
`packages/infra/vitest.config.ts` runs the SQL test files one after another (two files migrating an empty database
at the same time raced on `CREATE SCHEMA`).

### 5.3 Semantic search — **postponed by decision**, code parked

Present: `services/search` (NestJS indexer: Redis stream consumer `index:queue`, CI job log fetch, ANSI/timestamp
stripping, chunking, content-hash dedupe, batch embeddings), `packages/infra/src/{embeddings,search-logic,
search-queries,index-queue}.ts` (hybrid pgvector cosine + full-text with RRF), migration
`0002_search_documents.sql` (`vector` extension, `ci_job_logs`, `documents` with HNSW + GIN), gateway
`search.service.ts`, web `SearchSection`, `SimilarFailures`, `FailurePatterns`, `Highlight`. Compose adds
`ollama/ollama:0.34.4` (model `qwen3-embedding:0.6b`, volume `labwatch_ollama-models` kept) and `search`.
State when stopped: 204 log chunks (84 embedded), 16 commits, 5 PRs, 14 review comments, 3 events indexed.
**Ollama sat at its 3 GiB limit** — `OLLAMA_CONTEXT_LENGTH=1024`, `NUM_PARALLEL=1`, `MAX_LOADED_MODELS=1` were just
added; measure again (target ≤ 2 GiB, `docker inspect` → no OOMKilled) before enabling.
Removed from the running system on 2026-09-24 (the code stays on `labwatch-wip`): tables `documents` and
`ci_job_logs`, the `vector` extension and the 0002 row in `drizzle.__drizzle_migrations` (inside one transaction),
Redis keys `index:queue` and `search:*`, the `labwatch_ollama-models` volume and the `ollama` / `labwatch-search`
images. Postgres now runs `postgres:17.11-bookworm` (same build and glibc as before, so no reindex was needed); to
resume semantic search switch back to a pgvector image **with the same Debian base** (`pgvector/pgvector:pg17` was
bookworm) — a different glibc changes text collation and would require `REINDEX`.

### 5.4 AWS integration — **done** on `labwatch-tabs`

The reader key is in `.env`; the card is Connected and the Status page combines Home and AWS. If the card ever shows
**Auth error**, the collector log names the AWS error class (e.g. `UnrecognizedClientException` = wrong key id,
`InvalidSignatureException` = wrong secret, `AccessDeniedException` = the user lacks read access to the table);
create a new access key for `syssoft-labs-labwatch-reader`, replace the two lines in `.env` and run
`docker compose up -d collector`.

## 6. Other follow-ups

- **Test report**: add `dorny/test-reporter` to `.github/workflows/ci.yml` (on the `ci-faster-review` branch / PR #2)
  so CI publishes a "Test results" check run that labwatch already knows how to read.
- **HCP token**: HCP Terraform → organization settings → API tokens → team or organization token (read-only use),
  put into `.env` as `HCP_TERRAFORM_TOKEN`.
- CD (later): images → GHCR, deploy to kind with ArgoCD; lab `.exe` → GitHub Releases.
- Teacher's suggestions (later): SonarQube (Cloud, free for public repos), Jenkins (in Docker), ArgoCD.

## 7. Verify before calling it done

```bash
cd ~/projects/syssoft-labs/labwatch
pnpm -r typecheck && pnpm -r test && pnpm -r build
docker compose up -d --build && docker compose ps
curl -s localhost:8080/healthz          # ok
```
