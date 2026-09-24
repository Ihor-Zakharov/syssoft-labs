import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Poller } from '../logic/poller.js';

/** Base for services that run one adaptive polling loop for the lifetime of the app. */
export abstract class PollingService implements OnApplicationBootstrap, OnModuleDestroy {
  protected readonly logger: Logger;
  private readonly poller: Poller;

  protected constructor(name: string, private readonly initialDelayMs = 0) {
    this.logger = new Logger(name);
    this.poller = new Poller(name, () => this.poll(), {
      error: (message, error) => this.logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`),
    });
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
