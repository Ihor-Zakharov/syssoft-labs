# labwatch

A small monitoring system for this repository: CI runs, commits, pull requests and the lab source file
(`manual.txt`), plus the health of its own services — on one live dashboard.

Built as practice for a production stack: **NestJS microservices, tRPC, PostgreSQL, Redis, React, Docker, CI**.

```
                 GitHub REST API                      https://91.202.128.107/manual.txt
                        ▲  conditional requests (ETag)             ▲  every 5 min
                        │                                          │
        ┌───────────────┴──────────────────────────────────────────┴──┐
        │ collector (NestJS)                                           │
        │  adaptive pollers: CI · commits/branches · PRs · source      │
        │  history → Postgres      current state → Redis status:*      │
        │  state CHANGE → event (Postgres + Redis stream) → PUBLISH    │
        │  heartbeat → Redis health:collector (TTL 45 s)               │
        └───────────────┬──────────────────────────────┬───────────────┘
                        │                              │
        PostgreSQL 17 + pgvector ◄──────────┐ ┌───────► Redis 8
        (history, migrations)               │ │        (state, cache, events stream, pub/sub)
                                            │ │
        ┌───────────────────────────────────┴─┴────────────────────────┐
        │ gateway (NestJS + tRPC v11)                                  │
        │  queries: overview · ciRuns · ciJobs · commits · pulls ·     │
        │           sourceProbes · events                              │
        │  subscription "updates": Redis pub/sub → server-sent events  │
        │  watchdog: expired heartbeat → service.down / service.up     │
        └───────────────────────────┬──────────────────────────────────┘
                                    │ /trpc (HTTP batch + SSE)
        ┌───────────────────────────┴──────────────────────────────────┐
        │ web (React + Vite + TanStack Query), served by nginx :8080   │
        │  health tiles · source card · CI runs · commits · PRs · feed │
        └──────────────────────────────────────────────────────────────┘
```

## Run it

Everything in Docker:

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and REDIS_PASSWORD (e.g. openssl rand -hex 16)
docker compose up -d --build
open http://localhost:8080
```

With a GitHub token polling is much faster (see below). Pass it via the environment rather than a file, for example
`GITHUB_TOKEN=$(gh auth token) docker compose up -d`, or put a fine-grained read-only token into `.env`.

Development (services on the host, hot reload; Postgres and Redis from compose):

```bash
docker compose up -d postgres redis
pnpm install
pnpm dev                      # collector :3001, gateway :3000, web :5173 (proxies /trpc to :3000)
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`. CI runs the same plus a Docker build of every image
(`.github/workflows/labwatch.yml`, only when `labwatch/**` changes).

## Polling: how often and why

| Source | With token | Without token | Why |
|---|---|---|---|
| CI runs | 30 s while a run is queued/in progress, 2 min idle | 5 / 10 min | watch a running build live, stay quiet otherwise |
| CI jobs of active runs | every CI poll (≤ 3 runs) | not fetched | shows per-job progress |
| Branches + commits | 1 min (≤ 10 branches) | 15 min (≤ 5 branches) | |
| Pull requests | 2 min | 20 min | |
| `manual.txt` source | 5 min | 5 min | someone else's server: be polite |
| Heartbeats | 15 s, key TTL 45 s | same | local, free |

Every GitHub request carries `If-None-Match` with the ETag of the previous answer. An unchanged resource comes back
as `304 Not Modified` with no body, and **authenticated 304s do not count against the 5000/hour limit** — so frequent
polling is almost free. Without a token the limit is 60/hour and 304s do count, so the intervals are stretched;
`estimateRequestsPerHour()` has a test proving the worst case stays under the limit. When the quota drops to 5 the
collector waits for the reset time it read from the `x-ratelimit-*` headers.

## Redis vs Postgres

**Redis — "what is it now"** (small, fast, may be lost: the next poll rebuilds it):

| Key | Content |
|---|---|
| `status:ci:<repo>` | latest 20 runs, active count, jobs of active runs |
| `status:commits:<repo>`, `status:prs:<repo>` | branches + recent commits, pull requests |
| `status:source` | last probe of `manual.txt` with pin/hash verdicts |
| `health:<service>` | heartbeat, expires after 45 s → "down" without any prober |
| `github:ratelimit` | quota left and reset time |
| `etag:<url>` | ETag + already mapped data (TTL 1 day) |
| `state:*` | last known states for change detection |
| `events` (stream, ~1000) | the event feed |
| `updates` (pub/sub) | "topic X changed" notifications for live UIs |

Redis runs with `maxmemory 256mb` and `volatile-lru`: under memory pressure only keys with a TTL (cache, heartbeats)
are evicted, never the stream or the states.

**Postgres — history** (source of truth for anything over time): `ci_runs`, `ci_jobs`, `commits`, `branches`,
`pull_requests`, `source_probes`, `events`. The schema lives in `packages/infra/src/schema.ts` (Drizzle); SQL migrations
are generated into `packages/infra/drizzle/` (`pnpm db:generate`) and applied by the collector on startup.

## Events: state changes only

A feed that repeats "CI is green" every 30 s is noise. Events are produced only on transitions:

- `ci.failed` / `ci.recovered` — the latest success/failure of a workflow on a branch flipped (cancelled and skipped
  runs say nothing about health and are ignored);
- `source.down` / `source.up`, `source.body_changed`, `source.cert_changed`;
- `service.down` / `service.up` — detected by the gateway's watchdog, because a dead service cannot report itself.

The first observation after a start (no previous state) seeds silently, so restarts do not flood the feed.

## The lab source and its certificate

`manual.txt` is served over HTTPS by an IP address with a certificate issued for `mail.univ.net.ua` that expired on
2026-08-20, so standard TLS validation always fails. The probe records the validation error and the certificate's
SHA-256 fingerprint and decides by **pinning**: the source is OK only when the fingerprint equals the known one
(`SOURCE_EXPECTED_CERT_SHA256`). The body's SHA-256 is compared with `SOURCE_EXPECTED_BODY_SHA256` to notice content
changes. This mirrors what `Lab1/Task1` does in C#.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | — (required) | all |
| `POSTGRES_HOST` / `REDIS_HOST` | `localhost` | services (compose sets `postgres` / `redis`) |
| `DATABASE_URL`, `REDIS_URL` | built from the above | services |
| `GITHUB_TOKEN` | empty → slow polling | collector |
| `GITHUB_REPOS` | `Ihor-Zakharov/syssoft-labs` | collector, gateway |
| `GITHUB_DEFAULT_BRANCH` | `main` | collector |
| `SOURCE_URL` | `https://91.202.128.107/manual.txt` | collector |
| `SOURCE_EXPECTED_CERT_SHA256` | pinned fingerprint | collector |
| `SOURCE_EXPECTED_BODY_SHA256` | known hash; empty = skip | collector |

Every container has a `mem_limit` (Postgres 1 GB, Redis 512 MB, Node services 320 MB with a 192 MB heap, nginx 64 MB):
under WSL an out-of-memory situation would otherwise take down the whole VM.

## Layout

```
labwatch/
├─ compose.yaml            Postgres, Redis, collector, gateway, web
├─ packages/shared         types, zod schemas, Redis key names (browser-safe)
├─ packages/infra          Drizzle schema + migrations, Postgres/Redis factories, event sink, heartbeat
├─ services/collector      pollers, change detection, source probe
├─ services/gateway        tRPC router, dashboard queries, SSE updates, watchdog
└─ apps/web                React dashboard (+ nginx config for the container)
```

Type safety runs end to end: the web app imports only the **type** of the gateway's router
(`@labwatch/gateway/router`), so a changed procedure breaks the web build at compile time.

## Next phases

1. Kubernetes: kind cluster + Helm chart, e2e tests against the cluster in CI.
2. Embeddings: index CI logs and READMEs into pgvector, semantic search ("was there a failure like this before?").
3. Terraform against LocalStack: EventBridge + Lambda source probe, SQS between collector and search, S3 log archive.
