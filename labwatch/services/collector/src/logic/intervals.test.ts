import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_INTERVALS,
  UNAUTHENTICATED_INTERVALS,
  estimateRequestsPerHour,
  intervalsFor,
  nextCiDelay,
  rateLimitDelay,
} from './intervals.js';

describe('intervals', () => {
  it('polls CI fast while a run is active and slow when idle', () => {
    const i = AUTHENTICATED_INTERVALS;
    expect(nextCiDelay([{ status: 'completed' }, { status: 'in_progress' }], i)).toBe(30_000);
    expect(nextCiDelay([{ status: 'queued' }], i)).toBe(30_000);
    expect(nextCiDelay([{ status: 'completed' }], i)).toBe(120_000);
    expect(nextCiDelay([], i)).toBe(120_000);
  });

  it('keeps the unauthenticated worst case under the 60 requests/hour limit with a reserve', () => {
    expect(estimateRequestsPerHour(UNAUTHENTICATED_INTERVALS)).toBeLessThanOrEqual(55);
  });

  it('keeps the authenticated worst case far below 5000 requests/hour', () => {
    expect(estimateRequestsPerHour(AUTHENTICATED_INTERVALS)).toBeLessThan(2000);
  });

  it('picks intervals by authentication', () => {
    expect(intervalsFor(true)).toBe(AUTHENTICATED_INTERVALS);
    expect(intervalsFor(false)).toBe(UNAUTHENTICATED_INTERVALS);
    expect(UNAUTHENTICATED_INTERVALS.fetchJobs).toBe(false);
  });

  it('waits for the rate-limit window only when the quota is nearly exhausted', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const resetAt = '2026-09-24T12:10:00Z';
    expect(rateLimitDelay(null, now)).toBe(0);
    expect(rateLimitDelay({ remaining: 100, resetAt }, now)).toBe(0);
    expect(rateLimitDelay({ remaining: 5, resetAt }, now)).toBe(10 * 60_000 + 1_000);
    expect(rateLimitDelay({ remaining: 0, resetAt: '2026-09-24T11:00:00Z' }, now)).toBe(0);
  });
});
