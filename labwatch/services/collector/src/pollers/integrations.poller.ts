import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PollingService } from './polling-service.js';

/** GitHub state every minute (no extra requests); vendor pages and HCP Terraform every INTEGRATIONS_INTERVAL_S. */
@Injectable()
export class IntegrationsPoller extends PollingService {
  constructor(private readonly integrations: IntegrationsService) {
    super('IntegrationsPoller', 5_000);
  }

  protected async poll(): Promise<number> {
    await this.integrations.check();
    return 60_000;
  }
}
