import { describe, expect, it } from 'vitest';
import { HOUR_MS, PRIORITIES, RequestBudget, type Priority } from './budget.js';

function clock(start = Date.parse('2026-09-24T12:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

/** Max number of grants inside any window of `windowMs` (sliding over all grant times). */
function maxInAnyWindow(grants: number[], windowMs: number): number {
  let max = 0;
  let from = 0;
  for (let to = 0; to < grants.length; to++) {
    while (grants[to]! - grants[from]! >= windowMs) from++;
    max = Math.max(max, to - from + 1);
  }
  return max;
}

describe('RequestBudget', () => {
  it('gives each priority its share of the budget', () => {
    const c = clock();
    const budget = new RequestBudget({ budgetPerHour: 40, now: c.now });
    expect(PRIORITIES.map((p) => budget.capacity(p))).toEqual([40, 36, 32, 28, 24]);

    let backfill = 0;
    while (budget.tryAcquire('backfill')) backfill++;
    expect(backfill).toBe(24);
    // Higher priorities still have room
    expect(budget.tryAcquire('checks')).toBe(true);
    expect(budget.tryAcquire('ci')).toBe(true);
    expect(budget.tryAcquire('backfill')).toBe(false);
    expect(budget.used()).toBe(26);
  });

  it('frees a slot only when the oldest request leaves the rolling hour', () => {
    const c = clock();
    const budget = new RequestBudget({ budgetPerHour: 40, now: c.now });
    for (let i = 0; i < 40; i++) {
      expect(budget.tryAcquire('ci')).toBe(true);
      c.advance(60_000);
    }
    // 40 requests at t = 0..39 min; now t = 40 min
    expect(budget.tryAcquire('ci')).toBe(false);
    expect(budget.msUntilAvailable('ci')).toBe(20 * 60_000);
    // backfill must wait until only 23 requests remain in the window
    expect(budget.msUntilAvailable('backfill')).toBe(36 * 60_000);
    c.advance(20 * 60_000);
    expect(budget.tryAcquire('ci')).toBe(true);
    expect(budget.tryAcquire('ci')).toBe(false);
  });

  it('never exceeds the budget in any rolling hour, whatever the polling pattern', () => {
    // Deterministic pseudo-random polling: pollers of every priority firing at their own intervals
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const budgetPerHour of [40, 60, 2000]) {
      const c = clock();
      const grants: number[] = [];
      const byPriority = new Map<Priority, number>();
      const budget = new RequestBudget({ budgetPerHour, now: c.now, onGrant: (at) => grants.push(at) });
      const end = c.now() + 6 * HOUR_MS;
      while (c.now() < end) {
        const priority = PRIORITIES[Math.floor(random() * PRIORITIES.length)]!;
        const burst = 1 + Math.floor(random() * 5);
        for (let i = 0; i < burst; i++) {
          if (budget.tryAcquire(priority)) byPriority.set(priority, (byPriority.get(priority) ?? 0) + 1);
        }
        c.advance(Math.floor(random() * (budgetPerHour > 100 ? 2_000 : 90_000)));
      }
      expect(maxInAnyWindow(grants, HOUR_MS)).toBeLessThanOrEqual(budgetPerHour);
      // Lower classes can never take the share reserved for higher ones
      expect(maxInAnyWindow(grants, HOUR_MS)).toBeGreaterThan(budget.capacity('backfill'));
    }
  });

  it('keeps higher priorities served when lower ones are greedy', () => {
    const c = clock();
    const budget = new RequestBudget({ budgetPerHour: 40, now: c.now });
    let ci = 0;
    // Every minute: the backfill tries 10 requests, CI polling 1
    for (let minute = 0; minute < 180; minute++) {
      for (let i = 0; i < 10; i++) budget.tryAcquire('backfill');
      if (minute % 5 === 0 && budget.tryAcquire('ci')) ci++;
      c.advance(60_000);
    }
    expect(ci).toBe(36); // every CI poll went through
  });

  it('stops when GitHub reports that only the reserved part of the limit is left', () => {
    const c = clock();
    const budget = new RequestBudget({ budgetPerHour: 40, now: c.now });
    const resetAt = new Date(c.now() + 30 * 60_000).toISOString();
    budget.observe({ limit: 60, remaining: 22, resetAt }); // someone else already used 38
    expect(budget.tryAcquire('ci')).toBe(true); // 21 left
    expect(budget.tryAcquire('ci')).toBe(true); // 20 left = 60 - 40, the reserve
    expect(budget.tryAcquire('ci')).toBe(false);
    expect(budget.msUntilAvailable('ci')).toBe(30 * 60_000);
    c.advance(30 * 60_000);
    expect(budget.tryAcquire('ci')).toBe(true); // the GitHub window has reset
  });

  it('continues the window of a previous process', () => {
    const c = clock();
    const budget = new RequestBudget({ budgetPerHour: 3, now: c.now });
    budget.seed([c.now() - 30 * 60_000, c.now() - 10 * 60_000, c.now() - 2 * HOUR_MS]);
    expect(budget.used()).toBe(2);
    expect(budget.tryAcquire('ci')).toBe(true);
    expect(budget.tryAcquire('ci')).toBe(false);
    expect(budget.snapshot()).toMatchObject({ used: 3, budgetPerHour: 3 });
  });
});
