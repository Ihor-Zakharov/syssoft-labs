import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INTEGRATION_NAMES,
  INTEGRATION_SLOW_MS,
  RedisKeys,
  integrationLevel,
  type IntegrationId,
  type IntegrationStatus,
  type OurConnection,
  type VendorStatus,
} from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { CONFIG, VERSION, type CollectorConfig } from '../config.js';
import { GithubService } from '../github/github.service.js';
import { StatusStore } from '../infra/status-store.js';
import { REDIS } from '../infra/tokens.js';
import {
  decodeAwsHealth,
  diffIntegrations,
  githubConnection,
  missingComponents,
  parseAwsHealth,
  parseStatuspage,
  parseTfWorkspaces,
  vendorError,
  type IntegrationLevels,
} from '../logic/integrations.js';

const TIMEOUT_MS = 15_000;

const VENDORS = {
  github: { source: 'githubstatus.com', url: 'https://www.githubstatus.com', watched: ['API Requests', 'Actions', 'Pages', 'Git Operations'] },
  hashicorp: { source: 'status.hashicorp.com', url: 'https://status.hashicorp.com', watched: ['HCP Terraform', 'Terraform Registry', 'HCP API'] },
} as const;

const AWS_HEALTH_URL = 'https://health.aws.amazon.com/public/currentevents';

/**
 * Our side of the AWS integration. The 24/7 prober runs in AWS (Lambda every minute → DynamoDB, eu-central-1);
 * reading its latest check needs the read-only key of the IAM user syssoft-labs-labwatch-reader.
 */
export interface AwsProbeReader {
  latest(): Promise<OurConnection>;
}

export const AWS_PROBE_READER = Symbol('AWS_PROBE_READER');

/** Used until the DynamoDB reader is implemented and the read key is in .env (docs/HANDOFF.md §5.4). */
export class NoReadKeyAwsProbe implements AwsProbeReader {
  async latest(): Promise<OurConnection> {
    return {
      state: 'not_configured',
      summary: 'The prober runs in AWS; labwatch has no read key yet',
      hint:
        'Create an access key for the IAM user syssoft-labs-labwatch-reader (read-only, one DynamoDB table) and add ' +
        'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION=eu-central-1 to .env.',
      checkedAt: null,
      latencyMs: null,
      facts: [
        { label: 'Region', value: 'eu-central-1' },
        { label: 'Prober', value: 'Lambda syssoft-labs-status-prober, every minute' },
        { label: 'Table', value: 'syssoft-labs-status-checks' },
      ],
    };
  }
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private vendorCache = new Map<string, VendorStatus>();
  private hcpCache: OurConnection | null = null;
  private lastSlowFetch = 0;

  constructor(
    @Inject(CONFIG) private readonly config: CollectorConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AWS_PROBE_READER) private readonly aws: AwsProbeReader,
    private readonly github: GithubService,
    private readonly store: StatusStore,
  ) {}

  /** One round: GitHub (from the collector's own calls) every time, vendor pages and HCP Terraform every interval. */
  async check(): Promise<IntegrationStatus[]> {
    const now = new Date();
    if (Date.now() - this.lastSlowFetch >= this.config.integrations.intervalMs) {
      this.lastSlowFetch = Date.now();
      const [githubVendor, hashicorpVendor, awsVendor, hcp] = await Promise.all([
        this.statuspage('github', VENDORS.github),
        this.statuspage('hashicorp', VENDORS.hashicorp),
        this.awsHealth(),
        this.hcpTerraform(),
      ]);
      this.vendorCache.set('github', githubVendor);
      this.vendorCache.set('hashicorp', hashicorpVendor);
      this.vendorCache.set('aws', awsVendor);
      this.hcpCache = hcp;
    }

    const statuses = [
      this.build('github', this.githubConnection(), this.vendorCache.get('github') ?? null, now),
      this.build('aws', await this.aws.latest(), this.vendorCache.get('aws') ?? null, now),
      this.build('hcp-terraform', this.hcpCache ?? (await this.hcpTerraform()), this.vendorCache.get('hashicorp') ?? null, now),
    ];

    for (const status of statuses) await this.redis.set(RedisKeys.integration(status.id), JSON.stringify(status));
    const previous = await this.store.getJson<IntegrationLevels>(RedisKeys.integrationState);
    const { next, events } = diffIntegrations(previous, statuses, now);
    await this.store.setJson(RedisKeys.integrationState, next);
    await this.store.emit(events);
    await this.store.publish('integrations');
    return statuses;
  }

  private build(id: IntegrationId, ours: OurConnection, vendor: VendorStatus | null, now: Date): IntegrationStatus {
    const { level, label } = integrationLevel(ours, vendor);
    return { id, name: INTEGRATION_NAMES[id], level, label, ours, vendor, checkedAt: now.toISOString() };
  }

  /** GitHub needs no extra requests: token, quota and latency come from the collector's own calls. */
  private githubConnection(): OurConnection {
    return githubConnection({
      tokenConfigured: this.github.tokenConfigured,
      tokenRejected: this.github.isTokenRejected,
      authenticated: this.github.authenticated,
      stats: this.github.stats(),
      budget: this.github.rateLimitSnapshot(),
    });
  }

  private async hcpTerraform(): Promise<OurConnection> {
    const { hcpTerraformToken: token, hcpTerraformOrg: org } = this.config.integrations;
    const orgFact = { label: 'Organization', value: org };
    if (!token) {
      return {
        state: 'not_configured',
        summary: 'No HCP Terraform token',
        hint: 'State lives in HCP Terraform, but labwatch has no token to read it. Create an organization token (Organization settings → API tokens; the Free plan has no read-only token type) and add it as HCP_TERRAFORM_TOKEN to .env.',
        checkedAt: null,
        latencyMs: null,
        facts: [orgFact],
      };
    }
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(
        `https://app.terraform.io/api/v2/organizations/${encodeURIComponent(org)}/workspaces?include=current_state_version&page%5Bsize%5D=50`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json', 'User-Agent': `labwatch-collector/${VERSION}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const latencyMs = Math.round(performance.now() - started);
      if (response.status === 401 || response.status === 403) {
        return { state: 'auth_error', summary: `HCP Terraform rejected the token (${response.status})`, hint: 'Check HCP_TERRAFORM_TOKEN.', checkedAt, latencyMs, facts: [orgFact] };
      }
      if (response.status === 404) {
        return { state: 'auth_error', summary: `Organization "${org}" not found or not visible to this token`, hint: 'Check HCP_TERRAFORM_ORG and the token’s team access.', checkedAt, latencyMs, facts: [orgFact] };
      }
      if (!response.ok) {
        return { state: 'unreachable', summary: `HCP Terraform answered HTTP ${response.status}`, hint: null, checkedAt, latencyMs, facts: [orgFact] };
      }
      const workspaces = parseTfWorkspaces((await response.json()) as Parameters<typeof parseTfWorkspaces>[0]);
      return {
        state: latencyMs > INTEGRATION_SLOW_MS ? 'slow' : 'connected',
        summary: `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`,
        hint: null,
        checkedAt,
        latencyMs,
        facts: [orgFact, { label: 'API latency', value: `${latencyMs} ms` }],
        workspaces,
      };
    } catch (error) {
      return {
        state: 'unreachable',
        summary: `HCP Terraform unreachable: ${error instanceof Error ? error.message : String(error)}`,
        hint: null,
        checkedAt,
        latencyMs: null,
        facts: [orgFact],
      };
    }
  }

  private async statuspage(key: string, meta: { source: string; url: string; watched: readonly string[] }): Promise<VendorStatus> {
    const now = new Date();
    try {
      const summary = await this.json(`${meta.url}/api/v2/summary.json`);
      // status.hashicorp.com leaves some components out of the summary
      const extra = missingComponents(summary, meta.watched)
        ? ((await this.json(`${meta.url}/api/v2/components.json`)) as { components?: [] }).components
        : undefined;
      return parseStatuspage(summary, { ...meta, checkedAt: now }, extra);
    } catch (error) {
      this.logger.warn(`${key} vendor status: ${error instanceof Error ? error.message : String(error)}`);
      return vendorError(meta, error instanceof Error ? error.message : String(error), now);
    }
  }

  private async awsHealth(): Promise<VendorStatus> {
    const now = new Date();
    const region = this.config.integrations.awsHealthRegion;
    try {
      const response = await fetch(AWS_HEALTH_URL, { headers: { 'User-Agent': `labwatch-collector/${VERSION}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return parseAwsHealth(decodeAwsHealth(bytes), region, { url: AWS_HEALTH_URL, checkedAt: now });
    } catch (error) {
      // An undocumented feed: when it changes, show "n/a" rather than a wrong verdict
      this.logger.warn(`AWS Health: ${error instanceof Error ? error.message : String(error)}`);
      return vendorError({ source: `AWS Health (${region})`, url: 'https://health.aws.amazon.com/health/status' }, error instanceof Error ? error.message : String(error), now);
    }
  }

  private async json(url: string): Promise<Parameters<typeof parseStatuspage>[0]> {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': `labwatch-collector/${VERSION}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return (await response.json()) as Parameters<typeof parseStatuspage>[0];
  }
}
