# labwatch

A small monitoring system for this repository: CI runs (with jobs, steps and test results), the agentic
code review, commits attributed to labs, pull requests, the lab source file (`manual.txt`), a
statuspage-style uptime page for the university sites, and the health of its own services — on one live
dashboard.

Built as practice for a production stack: **NestJS microservices, tRPC, PostgreSQL, Redis, React, Docker, CI**.

```
      GitHub REST API (ETag, rolling-hour budget)     manual.txt · 4 status-page sites
                        ▲                                      ▲  every 5 min · every 60 s
                        │                                      │
        ┌───────────────┴──────────────────────────────────────┴──────┐
        │ collector (NestJS)                                           │
        │  periodic: CI runs · branch heads · PR list · source · sites │
        │  event-driven sync (by priority): reviews/comments → commits │
        │    of moved branches → check runs + jobs → compare + files   │
        │  history → Postgres      current state → Redis status:*      │
        │  state CHANGE → event (Postgres + Redis stream) → PUBLISH    │
        │  heartbeat → Redis health:collector (TTL 45 s)               │
        └───────────────┬──────────────────────────────┬───────────────┘
                        │                              │
        PostgreSQL 17 + pgvector ◄──────────┐ ┌───────► Redis 8
        (history, migrations, SQL buckets)  │ │        (state, ETag cache, budget, events, pub/sub)
                                            │ │
        ┌───────────────────────────────────┴─┴────────────────────────┐
        │ gateway (NestJS + tRPC v11)                                  │
        │  overview · branches · ciRuns/ciRun · commits · pulls/pull · │
        │  statusPage · incidents · events · sourceProbes              │
        │  subscription "updates": Redis pub/sub → server-sent events  │
        │  watchdog: expired heartbeat → service.down / service.up     │
        └───────────────────────────┬──────────────────────────────────┘
                                    │ /trpc (HTTP batch + SSE)
        ┌───────────────────────────┴──────────────────────────────────┐
        │ web (React + Vite + TanStack Query), served by nginx :8080   │
        │  System: services · lab source · events · integrations       │
        │  Repository: CI runs | Commits | Pull requests | Status      │
        │    Overview | main | branch tabs …                           │
        └──────────────────────────────────────────────────────────────┘
```

## Run it

Everything in Docker:

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and REDIS_PASSWORD (e.g. openssl rand -hex 16)
docker compose up -d --build
open http://localhost:8080
```

**A GitHub token is recommended.** Without one labwatch works, but stays within 40 requests per hour
(see below) and fills in commit files, comparisons and test reports slowly. Create a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with
*Public repositories (read-only)* access and no other permissions, put it into `.env` yourself as
`GITHUB_TOKEN=…` and run `docker compose up -d` again. The collector reads `.env` through `env_file`
(optional: the stack starts without it). Never commit `.env` — it is git-ignored.

Development (services on the host, hot reload; Postgres and Redis from compose):

```bash
docker compose up -d postgres redis
pnpm install
pnpm dev                      # collector :3001, gateway :3000, web :5173 (proxies /trpc to :3000)
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`. The SQL tests of the status page run against a real
Postgres when `POSTGRES_PASSWORD` (or `DATABASE_URL`) is set — e.g. `set -a; . ./.env; set +a; pnpm test` —
and inside a rolled-back transaction, so they leave nothing behind. CI runs everything with a Postgres service
container plus a Docker build of every image (`.github/workflows/labwatch.yml`, only when `labwatch/**` changes).

## The dashboard

Two top-level tabs; the URL hash keeps the position (`#system`, `#repo/ci/overview`,
`#repo/commits/branch/lab1-task3`, `#repo/status/24h`), so reload and back/forward work. Hashes from
before the split (`#ci/overview`, `#status/24h`, …) are redirected to their `#repo/…` form. All tabs are
keyboard accessible (arrow keys, Home/End), and switching tabs never shifts the layout: the scrollbar
gutter is reserved, tab captions reserve their bold width, tables use fixed column widths.

### System

- The four service cards (collector, gateway, postgres, redis — up/down, heartbeat age or ping latency,
  version), the `manual.txt` source card (HTTP, content hash, pinned certificate, TLS check, latency history,
  uptime) and the event feed.
- **Integrations** — one card per external service, with two levels: *our connection* and the *vendor's own
  status*. Card colour: Connected (green), Degraded (yellow: the vendor reports an incident or a watched
  component is not operational, or our calls are slow), Auth error / Unreachable (red), Not configured / Not
  deployed yet (grey). Results are kept in Redis (`status:integration:<id>`); a card turning red or back is an
  `integration.down` / `integration.up` event.

| Integration | Our connection | Vendor status (every 5 min) |
|---|---|---|
| GitHub | token present and accepted, rate limit (remaining/limit, reset), labwatch's hourly budget, average API latency of the last calls — no extra requests | githubstatus.com: overall indicator, API Requests, Actions, Pages, Git Operations, open incidents |
| HCP Terraform | with `HCP_TERRAFORM_TOKEN` (read-only team/organization token) every 5 min: the workspaces of `HCP_TERRAFORM_ORG` (execution mode, lock, resource count, current state version); without it "Not configured" | status.hashicorp.com: HCP Terraform, Terraform Registry, HCP API |
| AWS | the 24/7 prober runs in AWS (Lambda + DynamoDB, eu-central-1); until the read-only key of `syssoft-labs-labwatch-reader` is in `.env` and the DynamoDB reader is written (`docs/HANDOFF.md` §5.4) the card says "Not configured" and shows where the prober runs |

### Repository

**Primary row:** `CI runs` · `Commits` · `Pull requests` · `Status`.

**Secondary row** (not on Status): `Overview` (the section across all branches, with a Branch column) · `main`
· one tab per branch, ordered by latest activity (head commit, CI run or PR update). Merged branches and
branches idle for more than 14 days go into the trailing `…` menu. Each branch tab has a CI dot — green
success, red failure, yellow running, grey none — from the runs of the branch head, and a counter of review
findings on its PR. The Overview dot is the worst of: CI on main, the status page, the services and the
source. The selected branch is kept when switching sections.

- **CI runs:** runs with job badges, test totals and — for `Code review` runs — what the review posted. Expand
  a run for its jobs and steps (with durations and log links), the test report of the commit (totals, per
  test assembly and suite, failure annotations; "No test report" when there is none) and the review outcome.
- **Commits:** commits with lab badges (Lab 1 / CI / Infra / Repo) and an area filter; on a branch tab also
  ahead/behind main, the areas the branch touches, and "not in main" marks.
- **Pull requests:** state, draft, review decision, findings, base ← head, checks, touched areas. Expand for
  the reviews, each inline comment as `path:line` with its Markdown and a link to GitHub, and the
  conversation. A review run that finished without posting anything shows "review ran, no comments".
- **Status:** see below.

## GitHub API budget

Every GitHub call goes through one rolling-hour budget in the collector (`services/collector/src/logic/budget.ts`):

| | Budget | Why |
|---|---|---|
| without a token | `GITHUB_UNAUTH_BUDGET_PER_HOUR`, default **40** | GitHub allows 60/h per public IP; 20 stay free for live demos |
| with a token | `GITHUB_AUTH_BUDGET_PER_HOUR`, default **2000** | of 5000/h per token |

The request times are kept in a Redis sorted set, so a restart does not reset the window. Work is split into
priority classes, and lower classes may only use part of the budget, so they never starve the important ones:

| Priority | Share | Work |
|---|---|---|
| ci | 100 % | workflow runs, jobs of running workflows |
| reviews | 90 % | PR list, reviews, inline and conversation comments |
| commits | 80 % | branch heads, commits of branches whose head moved, lab discovery |
| checks | 70 % | check runs (test reports) and annotations, final jobs of finished runs |
| backfill | 60 % | compare (ahead/behind, touched areas), changed files of each commit |

GitHub's own counter is respected too: labwatch stops when `X-RateLimit-Remaining` drops to `limit − budget`
(20 of 60 without a token), until the reset time. Periodic polls are cheap by design — every request carries
`If-None-Match`, and only the branch list and the PR list are polled; everything else runs only when they show a
change. Commits and trees are immutable and fetched once per SHA (`commit_files`, `commit_details`).

| Periodic poll | With token | Without token |
|---|---|---|
| CI runs | 30 s while a run is active, 2 min idle | 5 / 10 min |
| Branch heads | 1 min | 15 min |
| PR list | 2 min | 20 min |
| Event-driven sync | 30 s | 2 min |
| `manual.txt` | 5 min | 5 min |
| Status-page sites | 60 s (not GitHub) | 60 s |

## Lab attribution

Commits are attributed by the **paths of the files they change**, not by their messages: `Lab<N>/…` → `Lab N`,
`labwatch/…` → `Infra`, `.github/…` → `CI`, anything else → `Repo`; a commit may get several badges. Labs are
discovered from the top-level `Lab<N>/` directories of the default branch. Branch and PR badges come from the
compare API (the files changed since the merge base).

## Status page

Four sites (`packages/shared/src/status.ts`) are checked every 60 s with a 10 s deadline from vantage `home`
(this PC). Every check is stored (`status_checks`: target, vantage, time, outcome, HTTP status, latency, TLS
result) — about 520k rows in 90 days — and checks older than `STATUS_RETENTION_DAYS` (120) are deleted hourly.

- **down** — timeout, connection error, 5xx or an unexpected 4xx; **degraded** — answered, but slower than
  `STATUS_DEGRADED_MS` (2000); **operational** otherwise. TLS problems are **not** an outage: the certificate
  result is recorded (`tls_ok`, `tls_error`) and shown as a small warning chip, availability is judged by HTTP.
- Banner: `All Systems Operational`, `Degraded Performance`, `Partial Outage` (some down), `Major Outage` (all or
  more than half down), or grey `No data` when there was no check in the last 3 minutes (PC off, collector down).
- Uptime bars per scale, computed in SQL with `date_bin` over a `generate_series` frame, aligned in
  `STATUS_TIMEZONE` (Europe/Kyiv): `1h` = 60 × 1 min, `24h` = 96 × 15 min, `7d` = 84 × 2 h, `30d` / `90d` = days.
  Colour by uptime: ≥ 99.9 % green, ≥ 99 % light green, ≥ 95 % yellow, below red, no data grey. Hover or use the
  arrow keys for period, uptime, avg/p95 latency and failed checks.
- Incidents open on the transition to down and resolve on recovery (at most one open incident per target,
  enforced by a partial unique index); both transitions go into the event feed as `status.down` / `status.up`.

The schema and the page are per vantage point, so a cloud vantage (e.g. `aws-eu-central-1`) can be added later.

## Redis vs Postgres

**Redis — "what is it now"** (small, fast, may be lost: the next poll rebuilds it):

| Key | Content |
|---|---|
| `status:ci:<repo>` | latest 20 runs, active count, jobs of active runs |
| `status:commits:<repo>` | default branch, labs, every branch head with its recent commits and its compare with main |
| `status:prs:<repo>` | the PR list |
| `status:source` | last probe of `manual.txt` with pin/hash verdicts |
| `status:checks:<vantage>` | hash: latest status-page check per site |
| `status:integration:<id>` | GitHub / AWS / HCP Terraform: our connection and the vendor status |
| `health:<service>` | heartbeat, expires after 45 s → "down" without any prober |
| `github:requests`, `github:budget` | request times of the rolling hour, budget configuration |
| `github:ratelimit` | GitHub's own quota and reset time |
| `etag:<url>` | ETag + already mapped data (TTL 1 day) |
| `state:*` | last known states for change detection |
| `events` (stream, ~1000) | the event feed |
| `updates` (pub/sub) | "topic X changed" notifications for live UIs |

**Postgres — history** (source of truth for anything over time): `ci_runs`, `ci_jobs` (with steps),
`test_reports`, `commits`, `branch_commits`, `commit_files`, `branches`, `pull_requests`, `pr_reviews`,
`pr_comments`, `source_probes`, `status_checks`, `status_incidents`, `events`. The schema lives in
`packages/infra/src/schema.ts` (Drizzle); SQL migrations are generated into `packages/infra/drizzle/`
(`pnpm db:generate`) and applied by the collector on startup.

## Events: state changes only

A feed that repeats "CI is green" every 30 s is noise. Events are produced only on transitions:
`ci.failed` / `ci.recovered`, `source.down` / `source.up`, `source.body_changed`, `source.cert_changed`,
`status.down` / `status.up` (status-page incidents), `service.down` / `service.up` (the gateway's watchdog —
a dead service cannot report itself). The first observation after a start seeds silently.

## The lab source and its certificate

`manual.txt` is served over HTTPS by an IP address with a certificate issued for `mail.univ.net.ua` that expired on
2026-08-20, so standard TLS validation always fails. The probe records the validation error and the certificate's
SHA-256 fingerprint and decides by **pinning**: the source is OK only when the fingerprint equals the known one
(`SOURCE_EXPECTED_CERT_SHA256`). The body's SHA-256 is compared with `SOURCE_EXPECTED_BODY_SHA256`. This mirrors
what `Lab1/Task1` does in C#.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | — (required) | all |
| `POSTGRES_HOST` / `REDIS_HOST`, `DATABASE_URL`, `REDIS_URL` | `localhost` / built from the above | services |
| `GITHUB_TOKEN` | empty → 40 requests/hour | collector |
| `GITHUB_UNAUTH_BUDGET_PER_HOUR` / `GITHUB_AUTH_BUDGET_PER_HOUR` | `40` / `2000` | collector |
| `GITHUB_REPOS`, `GITHUB_DEFAULT_BRANCH` | `Ihor-Zakharov/syssoft-labs`, `main` | collector, gateway |
| `TEST_REPORT_CHECK_PATTERN` | `^test results` (e.g. dorny/test-reporter) | collector |
| `REVIEW_WORKFLOW` | `Code review` | gateway |
| `SOURCE_URL`, `SOURCE_EXPECTED_CERT_SHA256`, `SOURCE_EXPECTED_BODY_SHA256` | lab source, pinned values | collector |
| `STATUS_ENABLED`, `STATUS_VANTAGE`, `STATUS_INTERVAL_S`, `STATUS_TIMEOUT_MS` | `true`, `home`, `60`, `10000` | collector |
| `STATUS_DEGRADED_MS`, `STATUS_RETENTION_DAYS` | `2000`, `120` | collector |
| `STATUS_TIMEZONE` | `Europe/Kyiv` | gateway |
| `HCP_TERRAFORM_TOKEN`, `HCP_TERRAFORM_ORG` | empty (Not configured), `zakharov-syssoft` | collector |
| `AWS_HEALTH_REGION`, `INTEGRATIONS_INTERVAL_S` | `eu-central-1`, `300` | collector |

Every container has a `mem_limit` (Postgres 1 GB, Redis 512 MB, Node services 320 MB with a 192 MB heap, nginx 64 MB):
under WSL an out-of-memory situation would otherwise take down the whole VM.

## Layout

```
labwatch/
├─ compose.yaml            Postgres, Redis, collector, gateway, web
├─ packages/shared         types, zod schemas, Redis keys; pure logic shared with the browser:
│                          lab areas, CI state, tab ordering, status levels and scales, review outcomes
├─ packages/infra          Drizzle schema + migrations, status-page SQL, connections, event sink, heartbeat
├─ services/collector      pollers, request budget, sync, source probe, status checks
├─ services/gateway        tRPC router, repository and status views, SSE updates, watchdog
└─ apps/web                React dashboard (+ nginx config for the container)
```

Type safety runs end to end: the web app imports only the **type** of the gateway's router
(`@labwatch/gateway/router`), so a changed procedure breaks the web build at compile time.

## Next phases

1. AWS vantage: read the 24/7 prober that already runs in AWS (Lambda + DynamoDB, see `docs/HANDOFF.md` §5.4).
2. Kubernetes: kind cluster + Helm chart, e2e tests against the cluster in CI, ArgoCD.
3. Semantic search over CI logs and reviews — postponed; the unfinished code is parked on the local branch
   `labwatch-wip` (see `docs/HANDOFF.md` §5.3).
