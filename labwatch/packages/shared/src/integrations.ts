// External services labwatch depends on: our connection to each of them and the vendor's own status.

export const INTEGRATION_IDS = ['github', 'aws', 'hcp-terraform'] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const INTEGRATION_NAMES: Record<IntegrationId, string> = {
  github: 'GitHub',
  aws: 'AWS',
  'hcp-terraform': 'HCP Terraform',
};

/** Our side of the connection. */
export type ConnectionState = 'connected' | 'slow' | 'auth_error' | 'unreachable' | 'not_configured' | 'not_deployed';

/** Statuspage indicators, plus "unknown" when the vendor page could not be read. */
export type VendorIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';

export interface VendorComponent {
  name: string;
  /** operational | degraded_performance | partial_outage | major_outage | under_maintenance | unknown */
  status: string;
}

export interface VendorIncident {
  name: string;
  impact: string;
  status: string;
  url: string | null;
  startedAt: string | null;
}

export interface VendorStatus {
  /** Human-readable source, e.g. "githubstatus.com". */
  source: string;
  url: string;
  indicator: VendorIndicator;
  description: string;
  components: VendorComponent[];
  incidents: VendorIncident[];
  checkedAt: string;
  error: string | null;
}

export interface TerraformWorkspace {
  name: string;
  executionMode: string;
  locked: boolean;
  resourceCount: number;
  stateSerial: number | null;
  stateCreatedAt: string | null;
  updatedAt: string | null;
}

export interface OurConnection {
  state: ConnectionState;
  summary: string;
  /** What to do about it (e.g. which variable to set). */
  hint: string | null;
  checkedAt: string | null;
  latencyMs: number | null;
  /** Integration-specific facts, rendered as a small key/value list. */
  facts: Array<{ label: string; value: string }>;
  workspaces?: TerraformWorkspace[];
}

/** The card colour: green / yellow / red / grey. */
export type IntegrationLevel = 'connected' | 'degraded' | 'error' | 'inactive';

export interface IntegrationStatus {
  id: IntegrationId;
  name: string;
  level: IntegrationLevel;
  label: string;
  ours: OurConnection;
  vendor: VendorStatus | null;
  checkedAt: string;
}

const VENDOR_TROUBLE: ReadonlySet<VendorIndicator> = new Set(['minor', 'major', 'critical']);
const COMPONENT_TROUBLE = new Set(['degraded_performance', 'partial_outage', 'major_outage']);

/** Does the vendor report a problem (an incident indicator or a watched component that is not operational)? */
export function vendorHasTrouble(vendor: VendorStatus | null): boolean {
  if (!vendor || vendor.error) return false;
  return VENDOR_TROUBLE.has(vendor.indicator) || vendor.components.some((c) => COMPONENT_TROUBLE.has(c.status));
}

/**
 * Card state from both levels: our problems (auth, unreachable) are red; a slow connection or an
 * incident reported by the vendor is yellow; not configured / not deployed is grey whatever the
 * vendor says; otherwise green.
 */
export function integrationLevel(ours: Pick<OurConnection, 'state'>, vendor: VendorStatus | null): { level: IntegrationLevel; label: string } {
  switch (ours.state) {
    case 'auth_error':
      return { level: 'error', label: 'Auth error' };
    case 'unreachable':
      return { level: 'error', label: 'Unreachable' };
    case 'not_configured':
      return { level: 'inactive', label: 'Not configured' };
    case 'not_deployed':
      return { level: 'inactive', label: 'Not deployed yet' };
    case 'slow':
      return { level: 'degraded', label: 'Degraded' };
    case 'connected':
      return vendorHasTrouble(vendor) ? { level: 'degraded', label: 'Degraded' } : { level: 'connected', label: 'Connected' };
  }
}

/** Our checks slower than this (average of recent calls) count as degraded. */
export const INTEGRATION_SLOW_MS = 2000;
