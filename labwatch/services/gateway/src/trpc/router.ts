import { STATUS_SCALE_KEYS } from '@labwatch/shared';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({
  sse: {
    // Keeps proxies from closing an idle stream; the client reconnects if pings stop
    ping: { enabled: true, intervalMs: 15_000 },
    client: { reconnectAfterInactivityMs: 40_000 },
  },
});

const limit = (max: number, fallback: number) =>
  z.object({ limit: z.number().int().min(1).max(max).default(fallback) }).default({ limit: fallback });

/** Optional branch filter: null = all branches ("Overview"). */
const byBranch = (max: number, fallback: number) =>
  z
    .object({
      branch: z.string().min(1).max(255).nullable().default(null),
      limit: z.number().int().min(1).max(max).default(fallback),
    })
    .default({ branch: null, limit: fallback });

export const appRouter = t.router({
  overview: t.procedure.query(({ ctx }) => ctx.api.overview()),

  /** Branch tabs: CI dot, activity, PR, ahead/behind. */
  branches: t.procedure.query(({ ctx }) => ctx.api.branches()),

  ciRuns: t.procedure.input(byBranch(200, 30)).query(({ ctx, input }) => ctx.api.ciRuns(input)),

  /** One run: jobs with steps, test reports of its commit, review outcome. */
  ciRun: t.procedure.input(z.object({ runId: z.number().int().positive() })).query(({ ctx, input }) => ctx.api.ciRun(input.runId)),

  ciJobs: t.procedure
    .input(z.object({ runId: z.number().int().positive() }))
    .query(({ ctx, input }) => ctx.api.ciJobs(input.runId)),

  commits: t.procedure.input(byBranch(200, 30)).query(({ ctx, input }) => ctx.api.commits(input)),

  pulls: t.procedure.input(byBranch(100, 30)).query(({ ctx, input }) => ctx.api.pulls(input)),

  /** One PR: reviews, inline comments (path:line) and conversation comments. */
  pull: t.procedure.input(z.object({ number: z.number().int().positive() })).query(({ ctx, input }) => ctx.api.pull(input.number)),

  sourceProbes: t.procedure.input(limit(500, 60)).query(({ ctx, input }) => ctx.api.sourceProbes(input.limit)),

  events: t.procedure.input(limit(500, 50)).query(({ ctx, input }) => ctx.api.events(input.limit)),

  /** `vantage`: `all` (combined) or one vantage id; unknown ids fall back to `all`. */
  statusPage: t.procedure
    .input(
      z
        .object({
          scale: z.enum(STATUS_SCALE_KEYS as [string, ...string[]]).default('24h'),
          vantage: z.string().max(64).default('all'),
        })
        .default({ scale: '24h', vantage: 'all' }),
    )
    .query(({ ctx, input }) => ctx.api.statusPage(input.scale as Parameters<Context['api']['statusPage']>[0], input.vantage)),

  incidents: t.procedure.input(limit(200, 30)).query(({ ctx, input }) => ctx.api.incidents(input.limit)),

  /** GitHub, AWS, HCP Terraform: our connection and the vendor's own status. */
  integrations: t.procedure.query(({ ctx }) => ctx.api.integrations()),

  /** Server-sent events: which part of the dashboard changed. */
  updates: t.procedure.subscription(async function* ({ ctx, signal }) {
    yield* ctx.updates.stream(signal);
  }),
});

export type AppRouter = typeof appRouter;
