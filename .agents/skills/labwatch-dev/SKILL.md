---
name: labwatch-dev
description: "Develop labwatch: run the stack, add a poller, a tRPC procedure or a UI tab, respect the GitHub rate budget. Use for any change under labwatch/."
---
# labwatch development

Runs in **WSL**: `~/projects/syssoft-labs/labwatch`. Architecture and state: `labwatch/README.md`,
`labwatch/docs/HANDOFF.md`.

```bash
cd labwatch
pnpm install --frozen-lockfile
docker compose up -d postgres redis            # infra only
pnpm dev                                        # services with watch; or the full stack:
docker compose up -d --build --no-deps gateway web   # rebuild only what changed, keep collector running
docker compose ps && docker compose logs -f collector
```

Where things go:
- **New data source / poller** → `services/collector` (NestJS). Every GitHub call goes through the shared budget
  limiter (≤ 40/h without a token, ≤ 2000/h with one) and ETag caching; history → Postgres (Drizzle migration in
  `packages/infra/drizzle`), current state → Redis (`packages/shared/src/keys.ts`), state changes → events.
- **New query** → `services/gateway` tRPC router (paged: `{page, pageSize=15}` → `{rows,total,page,pageSize}`).
  The web app imports only the router **type**.
- **New UI** → `apps/web` (React). No layout shift between tabs (`scrollbar-gutter: stable`, reserved widths);
  route in the URL hash (`src/route.ts`), tests for routing.
- Shared types/zod schemas → `packages/shared`.

Rules: never read `labwatch/.env` (presence checks only); keep `mem_limit` on every container; tests for new pure
logic (vitest); verify with `pnpm typecheck && pnpm test && pnpm build`.
