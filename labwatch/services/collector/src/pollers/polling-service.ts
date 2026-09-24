import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { BudgetExceededError } from '../logic/budget.js';
import { Poller } from '../logic/poller.js';

const MIN_BUDGET_RETRY_MS = 15_000;
const MAX_BUDGET_RETRY_MS = 5 * 60_000;

/** Base for services that run one adaptive polling loop for the lifetime of the app. */
export abstract class PollingService implements OnApplicationBootstrap, OnModuleDestroy {
  protected readonly logger: Logger;
  private readonly poller: Poller;

  protected constructor(name: string, private readonly initialDelayMs = 0) {
    this.logger = new Logger(name);
    this.poller = new Poller(
      name,
      async () => {
        try {
          return await this.poll();
        } catch (error) {
          // Not an error: the request budget is used up for this priority; try again when a slot frees
          if (error instanceof BudgetExceededError) {
            this.logger.log(error.message);
            return Math.min(Math.max(error.retryInMs, MIN_BUDGET_RETRY_MS), MAX_BUDGET_RETRY_MS);
          }
          throw error;
        }
      },
      {
        error: (message, error) => this.logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`),
      },
    );
  }

  /** Does one round of work and returns the delay until the next round, in ms. */
  protected abstract poll(): Promise<number>;

  onApplicationBootstrap(): void {
    this.poller.start(this.initialDelayMs);
  }

  onModuleDestroy(): void {
    this.poller.stop();
  }
}
