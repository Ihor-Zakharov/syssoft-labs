import { INTEGRATION_SLOW_MS } from '@labwatch/shared';
import type {
  IntegrationLevel,
  OurConnection,
  IntegrationStatus,
  LabEvent,
  TerraformWorkspace,
  VendorComponent,
  VendorIncident,
  VendorIndicator,
  VendorStatus,
} from '@labwatch/shared';

// ── Statuspage (githubstatus.com, status.hashicorp.com) ──────────────────────

interface RawStatuspage {
  status?: { indicator?: string; description?: string };
  components?: Array<{ name: string; status: string; group?: boolean }>;
  incidents?: Array<{ name: string; impact?: string; status: string; shortlink?: string; started_at?: string; created_at?: string }>;
}

const INDICATORS = new Set<VendorIndicator>(['none', 'minor', 'major', 'critical', 'maintenance']);
const OPEN = (status: string) => status !== 'resolved' && status !== 'postmortem' && status !== 'completed';

/**
 * Reads a Statuspage summary (status + components + incidents). `watched` picks and orders the
 * components shown on the card; a watched component missing from the page is reported as "unknown".
 * `components` may come from a separate components.json when the summary omits them.
 */
export function parseStatuspage(
  raw: RawStatuspage,
  meta: { source: string; url: string; watched: readonly string[]; checkedAt: Date },
  extraComponents?: RawStatuspage['components'],
): VendorStatus {
  const indicator = raw.status?.indicator;
  const all = [...(raw.components ?? []), ...(extraComponents ?? [])].filter((c) => !c.group);
  const byName = new Map(all.map((c) => [c.name.trim().toLowerCase(), c]));
  const components: VendorComponent[] = meta.watched.map((name) => ({
    name,
    status: byName.get(name.toLowerCase())?.status ?? 'unknown',
  }));
  const incidents: VendorIncident[] = (raw.incidents ?? [])
    .filter((i) => OPEN(i.status))
    .map((i) => ({ name: i.name, impact: i.impact ?? 'none', status: i.status, url: i.shortlink ?? null, startedAt: i.started_at ?? i.created_at ?? null }));
  return {
    source: meta.source,
    url: meta.url,
    indicator: indicator && INDICATORS.has(indicator as VendorIndicator) ? (indicator as VendorIndicator) : 'unknown',
    description: raw.status?.description ?? 'Unknown',
    components,
    incidents,
    checkedAt: meta.checkedAt.toISOString(),
    error: null,
  };
}

/** Did the page include every watched component (else fetch components.json as well)? */
export function missingComponents(raw: RawStatuspage, watched: readonly string[]): boolean {
  const names = new Set((raw.components ?? []).map((c) => c.name.trim().toLowerCase()));
  return watched.some((w) => !names.has(w.toLowerCase()));
}

export function vendorError(meta: { source: string; url: string; watched?: readonly string[] }, error: string, checkedAt: Date): VendorStatus {
  return {
    source: meta.source,
    url: meta.url,
    indicator: 'unknown',
    description: 'Vendor status: n/a',
    components: (meta.watched ?? []).map((name) => ({ name, status: 'unknown' })),
    incidents: [],
    checkedAt: checkedAt.toISOString(),
    error,
  };
}

// ── AWS Health public events (health.aws.amazon.com/public/currentevents) ─

/**
 * The feed is served as UTF-16 (big-endian, with a byte order mark: content-type charset=utf-16).
 * Decode by BOM; fall back to UTF-8 for a plain answer.
 */
export function decodeAwsHealth(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1]!;
      swapped[i - 1] = bytes[i]!;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

interface RawAwsEvent {
  date?: string;
  arn?: string;
  region_name?: string;
  status?: string;
  service?: string;
  service_name?: string;
  summary?: string;
}

/** AWS Health status codes: 0 resolved, 1 informational, 2 degraded performance, 3 disruption. */
const AWS_SEVERITY: Record<string, { indicator: VendorIndicator; component: string }> = {
  '1': { indicator: 'none', component: 'operational' },
  '2': { indicator: 'minor', component: 'degraded_performance' },
  '3': { indicator: 'major', component: 'major_outage' },
};

function eventRegion(e: RawAwsEvent): string | null {
  const fromArn = /^arn:aws:health:([a-z0-9-]*):/.exec(e.arn ?? '')?.[1];
  if (fromArn) return fromArn;
  const fromService = /-([a-z]{2}(?:-[a-z]+)+-\d)$/.exec(e.service ?? '')?.[1];
  return fromService ?? null;
}

export function parseAwsHealth(text: string, region: string, meta: { url: string; checkedAt: Date }): VendorStatus {
  const events = JSON.parse(text) as RawAwsEvent[];
  if (!Array.isArray(events)) throw new Error('unexpected AWS Health format');
  const mine = events.filter((e) => eventRegion(e) === region && e.status !== '0');
  const worst = mine.reduce((max, e) => Math.max(max, Number(e.status ?? 0)), 0);
  const severity = AWS_SEVERITY[String(worst)];
  return {
    source: `AWS Health (${region})`,
    url: 'https://health.aws.amazon.com/health/status',
    indicator: severity?.indicator ?? 'none',
    description: mine.length === 0 ? `No open events in ${region}` : `${mine.length} open event${mine.length === 1 ? '' : 's'} in ${region}`,
    components: mine.map((e) => ({ name: e.service_name ?? e.service ?? 'AWS service', status: AWS_SEVERITY[e.status ?? '']?.component ?? 'unknown' })),
    incidents: mine.map((e) => ({
      name: `${e.service_name ?? 'AWS'}: ${e.summary ?? 'event'}`,
      impact: AWS_SEVERITY[e.status ?? '']?.indicator ?? 'none',
      status: 'open',
      url: null,
      startedAt: e.date && /^\d+$/.test(e.date) ? new Date(Number(e.date) * 1000).toISOString() : null,
    })),
    checkedAt: meta.checkedAt.toISOString(),
    error: null,
  };
}

// ── HCP Terraform workspaces (JSON:API) ────────────────────────────────────

interface RawTfWorkspaces {
  data?: Array<{
    id: string;
    attributes: {
      name: string;
      'execution-mode'?: string;
      locked?: boolean;
      'resource-count'?: number;
      'updated-at'?: string;
    };
    relationships?: { 'current-state-version'?: { data?: { id: string; type: string } | null } };
  }>;
  included?: Array<{ id: string; type: string; attributes: { serial?: number; 'created-at'?: string } }>;
}

export function parseTfWorkspaces(raw: RawTfWorkspaces): TerraformWorkspace[] {
  const states = new Map((raw.included ?? []).filter((i) => i.type === 'state-versions').map((i) => [i.id, i.attributes]));
  return (raw.data ?? [])
    .map((w) => {
      const stateId = w.relationships?.['current-state-version']?.data?.id;
      const state = stateId ? states.get(stateId) : undefined;
      return {
        name: w.attributes.name,
        executionMode: w.attributes['execution-mode'] ?? 'remote',
        locked: w.attributes.locked ?? false,
        resourceCount: w.attributes['resource-count'] ?? 0,
        stateSerial: state?.serial ?? null,
        stateCreatedAt: state?.['created-at'] ?? null,
        updatedAt: w.attributes['updated-at'] ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Events on level changes ────────────────────────────────────────────────

export type IntegrationLevels = Record<string, IntegrationLevel>;

/** integration.down when a card turns red, integration.up when it leaves red; first observation seeds silently. */
export function diffIntegrations(prev: IntegrationLevels | null, current: readonly IntegrationStatus[], now: Date): { next: IntegrationLevels; events: LabEvent[] } {
  const next: IntegrationLevels = { ...(prev ?? {}) };
  const events: LabEvent[] = [];
  for (const status of current) {
    const before = prev?.[status.id];
    next[status.id] = status.level;
    if (prev === null || before === undefined) continue;
    if (status.level === 'error' && before !== 'error') {
      events.push({
        kind: 'integration.down',
        severity: 'error',
        title: `${status.name}: ${status.label.toLowerCase()} — ${status.ours.summary}`,
        at: now.toISOString(),
        data: { integration: status.id, state: status.ours.state },
      });
    } else if (before === 'error' && status.level !== 'error') {
      events.push({
        kind: 'integration.up',
        severity: 'info',
        title: `${status.name} is ${status.label.toLowerCase()} again`,
        at: now.toISOString(),
        data: { integration: status.id, state: status.ours.state },
      });
    }
  }
  return { next, events };
}

// ── GitHub: our connection, from the collector's own calls ─────────────────

export interface GithubCallStats {
  avgLatencyMs: number | null;
  calls: number;
  lastOkAt: string | null;
  lastError: { at: string; status: number | null; message: string } | null;
}

export interface GithubBudgetSnapshot {
  used: number;
  budgetPerHour: number;
  remote: { limit: number; remaining: number; resetAt: string } | null;
}

function utcTime(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(11, 16) + ' UTC' : '—';
}

/**
 * A rejected token is an auth error even though the collector keeps working anonymously; a failed
 * call without an HTTP answer means unreachable; slow calls mean degraded.
 */
export function githubConnection(input: {
  tokenConfigured: boolean;
  tokenRejected: boolean;
  authenticated: boolean;
  stats: GithubCallStats;
  budget: GithubBudgetSnapshot;
}): OurConnection {
  const { stats, budget } = input;
  const remote = budget.remote;
  const tokenText = input.tokenRejected ? 'rejected (401), running anonymously' : input.authenticated ? 'present, authenticated' : 'none (anonymous)';
  const facts = [
    { label: 'Token', value: tokenText },
    { label: 'Rate limit', value: remote ? `${remote.remaining}/${remote.limit} left, resets ${utcTime(remote.resetAt)}` : 'not observed yet' },
    { label: 'labwatch budget', value: `${budget.used}/${budget.budgetPerHour} this hour` },
    { label: 'API latency', value: stats.avgLatencyMs !== null ? `${stats.avgLatencyMs} ms (last ${stats.calls} calls)` : 'no calls yet' },
  ];
  const base = { checkedAt: stats.lastOkAt ?? stats.lastError?.at ?? null, latencyMs: stats.avgLatencyMs, facts };
  if (input.tokenRejected || stats.lastError?.status === 401) {
    return {
      ...base,
      state: 'auth_error',
      summary: `GitHub rejected the token (401); continuing without it (${budget.budgetPerHour} requests/hour)`,
      hint: 'Put a new token into .env as GITHUB_TOKEN and restart the collector: docker compose up -d collector.',
    };
  }
  const hint = input.authenticated ? null : 'Add a fine-grained read-only GITHUB_TOKEN to .env for 2000 requests/hour.';
  if (stats.lastError) return { ...base, state: 'unreachable', summary: `Last call failed: ${stats.lastError.message}`, hint };
  if (stats.avgLatencyMs !== null && stats.avgLatencyMs > INTEGRATION_SLOW_MS) {
    return { ...base, state: 'slow', summary: `API calls are slow (${stats.avgLatencyMs} ms)`, hint };
  }
  return { ...base, state: 'connected', summary: input.authenticated ? 'Authenticated API access' : `Anonymous API access (${budget.budgetPerHour} requests/hour budget)`, hint };
}
