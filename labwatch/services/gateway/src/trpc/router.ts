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

export const appRouter = t.router({
  overview: t.procedure.query(({ ctx }) => ctx.api.overview()),

  ciRuns: t.procedure.input(limit(200, 30)).query(({ ctx, input }) => ctx.api.ciRuns(input.limit)),

  ciJobs: t.procedure
    .input(z.object({ runId: z.number().int().positive() }))
    .query(({ ctx, input }) => ctx.api.ciJobs(input.runId)),

  commits: t.procedure.input(limit(200, 30)).query(({ ctx, input }) => ctx.api.commits(input.limit)),

  pulls: t.procedure.input(limit(100, 20)).query(({ ctx, input }) => ctx.api.pulls(input.limit)),

  sourceProbes: t.procedure.input(limit(500, 60)).query(({ ctx, input }) => ctx.api.sourceProbes(input.limit)),

  events: t.procedure.input(limit(500, 50)).query(({ ctx, input }) => ctx.api.events(input.limit)),

  /** Server-sent events: which part of the dashboard changed. */
  updates: t.procedure.subscription(async function* ({ ctx, signal }) {
    yield* ctx.updates.stream(signal);
  }),
});

export type AppRouter = typeof appRouter;
