export interface PollerLogger {
  error(message: string, error?: unknown): void;
}

/**
 * Runs a task in a loop where the task itself decides the delay until its next run (adaptive
 * polling). setTimeout chaining instead of setInterval: a slow run never overlaps with the next one.
 */
export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(
    readonly name: string,
    private readonly task: () => Promise<number>,
    private readonly logger: PollerLogger,
    private readonly errorDelayMs = 60_000,
  ) {}

  start(initialDelayMs = 0): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(initialDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return !this.stopped;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    let delay: number;
    try {
      delay = await this.task();
    } catch (error) {
      this.logger.error(`${this.name} poll failed`, error);
      delay = this.errorDelayMs;
    }
    this.schedule(delay);
  }
}
