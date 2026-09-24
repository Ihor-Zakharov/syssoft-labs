/**
 * Every GitHub call goes through one rolling-window budget. Work is split into priority classes;
 * lower classes may only use part of the budget, so they can never starve the more important ones:
 *
 *   ci (100 %) > reviews (90 %) > commits (80 %) > checks (70 %) > backfill (60 %)
 *
 * e.g. with 40 requests/hour, backfill (commit files, compare) stops once 24 requests were made in
 * the last hour, while CI polling may still use all 40.
 */
export const PRIORITIES = ['ci', 'reviews', 'commits', 'checks', 'backfill'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_SHARE: Record<Priority, number> = {
  ci: 1,
  reviews: 0.9,
  commits: 0.8,
  checks: 0.7,
  backfill: 0.6,
};

export const HOUR_MS = 60 * 60 * 1000;

export interface RemoteRateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface BudgetOptions {
  budgetPerHour: number;
  windowMs?: number;
  now?: () => number;
  /** Called for every granted request (persistence, so a restart does not reset the window). */
  onGrant?: (at: number) => void;
}

export interface BudgetSnapshot {
  used: number;
  budgetPerHour: number;
  windowMs: number;
  remote: RemoteRateLimit | null;
}

export class RequestBudget {
  private stamps: number[] = [];
  private remote: (RemoteRateLimit & { resetMs: number }) | null = null;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(private readonly options: BudgetOptions) {
    this.windowMs = options.windowMs ?? HOUR_MS;
    this.now = options.now ?? Date.now;
  }

  get budgetPerHour(): number {
    return this.options.budgetPerHour;
  }

  /** Requests of earlier processes (e.g. from Redis), so the window survives restarts. */
  seed(stamps: Iterable<number>): void {
    this.stamps = [...this.stamps, ...stamps].sort((a, b) => a - b);
    this.prune();
  }

  /** How many requests this priority may have in the window. */
  capacity(priority: Priority): number {
    return Math.floor(this.options.budgetPerHour * PRIORITY_SHARE[priority]);
  }

  used(): number {
    this.prune();
    return this.stamps.length;
  }

  /**
   * GitHub's own counter, from the X-RateLimit-* headers. It also counts requests of other clients
   * sharing the token or IP; labwatch stops when fewer than `limit - budget` requests remain,
   * leaving that part of the limit to everyone else (e.g. 20 of 60 for live demos).
   */
  observe(rate: RemoteRateLimit): void {
    this.remote = { ...rate, resetMs: new Date(rate.resetAt).getTime() };
  }

  private remoteFloor(): number {
    return this.remote ? Math.max(0, this.remote.limit - this.options.budgetPerHour) : 0;
  }

  private remoteBlocked(now: number): boolean {
    return this.remote !== null && now < this.remote.resetMs && this.remote.remaining <= this.remoteFloor();
  }

  tryAcquire(priority: Priority): boolean {
    const now = this.now();
    this.prune(now);
    if (this.stamps.length >= this.capacity(priority)) return false;
    if (this.remoteBlocked(now)) return false;
    this.stamps.push(now);
    // Assume the request counts on GitHub's side too until the response says otherwise
    if (this.remote && now < this.remote.resetMs) this.remote.remaining -= 1;
    this.options.onGrant?.(now);
    return true;
  }

  /** How long until this priority could get a request (0 = now). */
  msUntilAvailable(priority: Priority): number {
    const now = this.now();
    this.prune(now);
    let wait = 0;
    const capacity = this.capacity(priority);
    if (this.stamps.length >= capacity) {
      // The request that has to leave the window before a slot frees up
      const blocking = this.stamps[this.stamps.length - capacity];
      wait = capacity === 0 ? this.windowMs : blocking! + this.windowMs - now;
    }
    if (this.remoteBlocked(now)) wait = Math.max(wait, this.remote!.resetMs - now);
    return Math.max(0, wait);
  }

  snapshot(): BudgetSnapshot {
    return {
      used: this.used(),
      budgetPerHour: this.options.budgetPerHour,
      windowMs: this.windowMs,
      remote: this.remote ? { limit: this.remote.limit, remaining: this.remote.remaining, resetAt: this.remote.resetAt } : null,
    };
  }

  private prune(now = this.now()): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i]! <= cutoff) i++;
    if (i > 0) this.stamps.splice(0, i);
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly priority: Priority,
    readonly retryInMs: number,
  ) {
    super(`GitHub request budget exhausted for ${priority} work, retry in ${Math.ceil(retryInMs / 1000)} s`);
    this.name = 'BudgetExceededError';
  }
}
