import { Inject, Injectable } from '@nestjs/common';
import { sourceProbes, type DbHandle } from '@labwatch/infra';
import { RedisKeys } from '@labwatch/shared';
import { CONFIG, type CollectorConfig } from '../config.js';
import { StatusStore } from '../infra/status-store.js';
import { DB } from '../infra/tokens.js';
import { intervalsFor } from '../logic/intervals.js';
import { diffSource, evaluateProbe, type SourceState } from '../logic/source.js';
import { probeSource } from '../logic/source-probe.js';
import { PollingService } from './polling-service.js';
import { probeRow } from './rows.js';

/** Checks the lab source (manual.txt): reachable, same content, same pinned certificate. */
@Injectable()
export class SourcePoller extends PollingService {
  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(DB) private readonly db: DbHandle,
    private readonly store: StatusStore,
  ) {
    super('SourcePoller', 1_000);
  }

  protected async poll(): Promise<number> {
    const probe = await probeSource(this.config.sourceUrl);
    const status = evaluateProbe(probe, {
      certSha256: this.config.expectedCertSha256,
      bodySha256: this.config.expectedBodySha256,
    });

    await this.db.db.insert(sourceProbes).values(probeRow(status));
    await this.store.setJson(RedisKeys.sourceStatus, status);

    const previous = await this.store.getJson<SourceState>(RedisKeys.sourceState);
    const { next, events } = diffSource(previous, status, new Date());
    await this.store.setJson(RedisKeys.sourceState, next);
    await this.store.emit(events);
    await this.store.publish('source');

    if (!status.ok) this.logger.warn(`Source not OK: ${status.error ?? `HTTP ${status.httpStatus}, pinned=${status.certPinned}`}`);
    // Same pace with or without a GitHub token: this is someone else's server
    return intervalsFor(true).sourceMs;
  }
}
