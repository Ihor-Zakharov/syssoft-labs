import { INTEGRATION_SLOW_MS, type OurConnection } from '@labwatch/shared';
import { parseTfWorkspaces } from './integrations.js';

export const HCP_TOKEN_HINT =
  'State lives in HCP Terraform, but labwatch has no token to read it. Create an organization token ' +
  '(Organization settings → API tokens; the Free plan has no read-only token type) and add it as HCP_TERRAFORM_TOKEN to .env.';

/**
 * Our side of the HCP Terraform card: lists the organization's workspaces with the current state
 * version. `fetch` is injectable so the three paths (no token, rejected token, connected) are testable.
 */
export async function hcpTerraformConnection(args: {
  token: string | undefined;
  org: string;
  userAgent: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => Date;
}): Promise<OurConnection> {
  const doFetch = args.fetch ?? fetch;
  const orgFact = { label: 'Organization', value: args.org };
  if (!args.token) {
    return { state: 'not_configured', summary: 'No HCP Terraform token', hint: HCP_TOKEN_HINT, checkedAt: null, latencyMs: null, facts: [orgFact] };
  }
  const started = performance.now();
  const checkedAt = (args.now?.() ?? new Date()).toISOString();
  try {
    const response = await doFetch(
      `https://app.terraform.io/api/v2/organizations/${encodeURIComponent(args.org)}/workspaces?include=current_state_version&page%5Bsize%5D=50`,
      {
        headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/vnd.api+json', 'User-Agent': args.userAgent },
        signal: AbortSignal.timeout(args.timeoutMs),
      },
    );
    const latencyMs = Math.round(performance.now() - started);
    if (response.status === 401 || response.status === 403) {
      return {
        state: 'auth_error',
        summary: `HCP Terraform rejected the token (${response.status})`,
        hint: 'Check HCP_TERRAFORM_TOKEN in .env (an organization token of this organization).',
        checkedAt,
        latencyMs,
        facts: [orgFact],
      };
    }
    if (response.status === 404) {
      return {
        state: 'auth_error',
        summary: `Organization "${args.org}" not found or not visible to this token`,
        hint: 'Check HCP_TERRAFORM_ORG and that the token belongs to this organization.',
        checkedAt,
        latencyMs,
        facts: [orgFact],
      };
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
