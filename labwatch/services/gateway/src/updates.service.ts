import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { UPDATES_CHANNEL, UpdateMessageSchema, type UpdateMessage } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { EventEmitter, on } from 'node:events';
import { REDIS_SUBSCRIBER } from './infra/tokens.js';
import { StatusService } from './status.service.js';
import type { UpdatesSource } from './trpc/context.js';

/**
 * One Redis subscription for the whole process, fanned out in memory to every connected browser
 * (each SSE stream is a listener). ioredis re-subscribes by itself after a reconnect.
 */
@Injectable()
export class UpdatesService implements UpdatesSource, OnModuleInit {
  private readonly logger = new Logger(UpdatesService.name);
  private readonly emitter = new EventEmitter().setMaxListeners(500);

  constructor(
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    private readonly status: StatusService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== UPDATES_CHANNEL) return;
      try {
        const parsed = UpdateMessageSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return;
        // A new round of status checks: cached status pages are outdated
        if (parsed.data.topic === 'status') this.status.invalidate();
        this.emitter.emit('update', parsed.data);
      } catch {
        this.logger.warn(`Ignoring malformed update: ${raw.slice(0, 100)}`);
      }
    });
    await this.subscriber.subscribe(UPDATES_CHANNEL);
  }

  get listeners(): number {
    return this.emitter.listenerCount('update');
  }

  async *stream(signal: AbortSignal | undefined): AsyncIterable<UpdateMessage> {
    try {
      for await (const [message] of on(this.emitter, 'update', signal ? { signal } : {})) {
        yield message as UpdateMessage;
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') throw error;
    }
  }
}
