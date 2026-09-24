import { describe, expect, it, vi } from 'vitest';
import { hcpTerraformConnection } from './hcp.js';

const base = { org: 'zakharov-syssoft', userAgent: 'labwatch-test', timeoutMs: 1000, now: () => new Date('2026-09-24T12:00:00Z') };

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/vnd.api+json' } });
}

describe('HCP Terraform card', () => {
  it('is not configured without a token and says which token to create', async () => {
    const fetch = vi.fn();
    const card = await hcpTerraformConnection({ ...base, token: undefined, fetch });
    expect(card).toMatchObject({ state: 'not_configured', summary: 'No HCP Terraform token', checkedAt: null });
    expect(card.hint).toContain('organization token');
    expect(card.hint).toContain('Free plan has no read-only token type');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists the workspaces with their state when the token works', async () => {
    const fetch = vi.fn(async () =>
      response(200, {
        data: [
          {
            id: 'ws-1',
            attributes: { name: 'syssoft-labs-aws-bootstrap', 'execution-mode': 'local', locked: false, 'resource-count': 7, 'updated-at': '2026-09-24T11:00:00Z' },
            relationships: { 'current-state-version': { data: { id: 'sv-1', type: 'state-versions' } } },
          },
          {
            id: 'ws-2',
            attributes: { name: 'syssoft-labs-aws-status', 'execution-mode': 'local', locked: false, 'resource-count': 9, 'updated-at': '2026-09-24T11:30:00Z' },
            relationships: { 'current-state-version': { data: { id: 'sv-2', type: 'state-versions' } } },
          },
        ],
        included: [
          { id: 'sv-1', type: 'state-versions', attributes: { serial: 3, 'created-at': '2026-09-24T11:00:00Z' } },
          { id: 'sv-2', type: 'state-versions', attributes: { serial: 1, 'created-at': '2026-09-24T11:30:00Z' } },
        ],
      }),
    );
    const card = await hcpTerraformConnection({ ...base, token: 'tok', fetch });

    expect(card).toMatchObject({ state: 'connected', summary: '2 workspaces', hint: null });
    expect(card.workspaces?.map((w) => [w.name, w.resourceCount, w.stateSerial])).toEqual([
      ['syssoft-labs-aws-bootstrap', 7, 3],
      ['syssoft-labs-aws-status', 9, 1],
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/organizations/zakharov-syssoft/workspaces');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('reports a rejected token as an auth error', async () => {
    const card = await hcpTerraformConnection({ ...base, token: 'bad', fetch: vi.fn(async () => response(401)) });
    expect(card).toMatchObject({ state: 'auth_error', summary: 'HCP Terraform rejected the token (401)' });
    expect(card.hint).toContain('HCP_TERRAFORM_TOKEN');
  });

  it('reports an unknown organization and network failures', async () => {
    expect((await hcpTerraformConnection({ ...base, token: 't', fetch: vi.fn(async () => response(404)) })).state).toBe('auth_error');
    expect((await hcpTerraformConnection({ ...base, token: 't', fetch: vi.fn(async () => response(503)) })).state).toBe('unreachable');
    const down = await hcpTerraformConnection({
      ...base,
      token: 't',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    expect(down).toMatchObject({ state: 'unreachable', summary: 'HCP Terraform unreachable: fetch failed' });
  });
});
