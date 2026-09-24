import { describe, expect, it } from 'vitest';
import { RequestBudget } from './budget.js';
import {
  AUTHENTICATED_INTERVALS,
  UNAUTHENTICATED_INTERVALS,
  estimatePeriodicRequestsPerHour,
  intervalsFor,
  nextCiDelay,
} from './intervals.js';

describe('intervals', () => {
  it('polls CI fast while a run is active and slow when idle', () => {
    const i = AUTHENTICATED_INTERVALS;
    expect(nextCiDelay([{ status: 'completed' }, { status: 'in_progress' }], i)).toBe(30_000);
    expect(nextCiDelay([{ status: 'queued' }], i)).toBe(30_000);
    expect(nextCiDelay([{ status: 'completed' }], i)).toBe(120_000);
    expect(nextCiDelay([], i)).toBe(120_000);
  });

  it('keeps the periodic polls inside the lowest priority share of the default budgets', () => {
    // Periodic polls alone must leave room for event-driven work even in the worst case
    const unauth = new RequestBudget({ budgetPerHour: 40 });
    const auth = new RequestBudget({ budgetPerHour: 2000 });
    expect(estimatePeriodicRequestsPerHour(UNAUTHENTICATED_INTERVALS)).toBeLessThan(unauth.capacity('backfill'));
    expect(estimatePeriodicRequestsPerHour(AUTHENTICATED_INTERVALS)).toBeLessThan(auth.capacity('backfill'));
  });

  it('picks intervals by authentication', () => {
    expect(intervalsFor(true)).toBe(AUTHENTICATED_INTERVALS);
    expect(intervalsFor(false)).toBe(UNAUTHENTICATED_INTERVALS);
    expect(UNAUTHENTICATED_INTERVALS.fetchJobs).toBe(false);
  });
});
