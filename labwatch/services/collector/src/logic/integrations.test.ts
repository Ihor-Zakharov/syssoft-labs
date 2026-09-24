import { integrationLevel, type IntegrationStatus } from '@labwatch/shared';
import { describe, expect, it } from 'vitest';
import { decodeAwsHealth, diffIntegrations, missingComponents, parseAwsHealth, parseStatuspage, parseTfWorkspaces, vendorError } from './integrations.js';

const now = new Date('2026-09-24T12:00:00Z');

// Trimmed copy of https://www.githubstatus.com/api/v2/summary.json
const GITHUB_SUMMARY = {
  page: { name: 'GitHub' },
  status: { indicator: 'minor', description: 'Partially Degraded Service' },
  components: [
    { name: 'Git Operations', status: 'operational' },
    { name: 'Visit www.githubstatus.com for more information', status: 'operational' },
    { name: 'API Requests', status: 'operational' },
    { name: 'Actions', status: 'degraded_performance' },
    { name: 'Pages', status: 'operational' },
  ],
  incidents: [
    { name: 'Disruption with some GitHub services', impact: 'minor', status: 'investigating', shortlink: 'https://stspg.io/x', started_at: '2026-09-24T11:40:00Z' },
    { name: 'Old thing', impact: 'major', status: 'resolved' },
  ],
  scheduled_maintenances: [],
};

describe('parseStatuspage', () => {
  const meta = { source: 'githubstatus.com', url: 'https://www.githubstatus.com', watched: ['API Requests', 'Actions', 'Pages', 'Git Operations'], checkedAt: now };

  it('reads the indicator, watched components in order and open incidents', () => {
    const status = parseStatuspage(GITHUB_SUMMARY, meta);
    expect(status).toMatchObject({ indicator: 'minor', description: 'Partially Degraded Service', error: null });
    expect(status.components).toEqual([
      { name: 'API Requests', status: 'operational' },
      { name: 'Actions', status: 'degraded_performance' },
      { name: 'Pages', status: 'operational' },
      { name: 'Git Operations', status: 'operational' },
    ]);
    expect(status.incidents).toEqual([
      { name: 'Disruption with some GitHub services', impact: 'minor', status: 'investigating', url: 'https://stspg.io/x', startedAt: '2026-09-24T11:40:00Z' },
    ]);
  });

  it('takes components from a separate components.json and marks missing ones unknown', () => {
    // status.hashicorp.com: summary.json lacks "HCP Terraform", components.json has it
    const summary = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [{ name: 'HCP API', status: 'operational' }] };
    const watched = ['HCP Terraform', 'Terraform Registry', 'HCP API'];
    expect(missingComponents(summary, watched)).toBe(true);
    const status = parseStatuspage(summary, { ...meta, watched }, [{ name: 'HCP Terraform', status: 'partial_outage' }, { name: 'Group', status: 'operational', group: true }]);
    expect(status.components).toEqual([
      { name: 'HCP Terraform', status: 'partial_outage' },
      { name: 'Terraform Registry', status: 'unknown' },
      { name: 'HCP API', status: 'operational' },
    ]);
    expect(status.incidents).toEqual([]);
  });

  it('tolerates odd indicators and reports errors as n/a', () => {
    expect(parseStatuspage({ status: { indicator: 'weird' } }, meta).indicator).toBe('unknown');
    expect(vendorError(meta, 'timeout', now)).toMatchObject({ indicator: 'unknown', description: 'Vendor status: n/a', error: 'timeout' });
  });
});

function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) >> 8;
    out[3 + i * 2] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

const AWS_EVENTS = [
  { date: '1790240000', arn: 'arn:aws:health:eu-central-1::event/EC2/X', region_name: 'Frankfurt', status: '2', service: 'ec2-eu-central-1', service_name: 'Amazon EC2', summary: 'Increased API latency' },
  { date: '1790240100', arn: 'arn:aws:health:eu-central-1::event/LAMBDA/Y', region_name: 'Frankfurt', status: '3', service: 'lambda-eu-central-1', service_name: 'AWS Lambda', summary: 'Invocation errors' },
  { date: '1790240200', arn: 'arn:aws:health:eu-central-1::event/S3/Z', status: '0', service: 's3-eu-central-1', service_name: 'Amazon S3', summary: 'Resolved' },
  { date: '1772369485', arn: 'arn:aws:health:me-central-1::event/MULTIPLE', region_name: 'UAE', status: '3', service: 'multipleservices-me-central-1', service_name: 'Multiple services', summary: 'Region Availability' },
];

describe('AWS Health feed', () => {
  it('decodes UTF-16 BE with BOM, UTF-16 LE and UTF-8', () => {
    const text = JSON.stringify([{ summary: 'Київ ✓' }]);
    expect(decodeAwsHealth(utf16be(text))).toBe(text);
    const le = new Uint8Array([0xff, 0xfe, ...Buffer.from(text, 'utf16le')]);
    expect(decodeAwsHealth(le)).toBe(text);
    expect(decodeAwsHealth(new TextEncoder().encode(text))).toBe(text);
  });

  it('reports open events of one region only, worst severity wins', () => {
    const status = parseAwsHealth(decodeAwsHealth(utf16be(JSON.stringify(AWS_EVENTS))), 'eu-central-1', { url: 'u', checkedAt: now });
    expect(status).toMatchObject({ indicator: 'major', description: '2 open events in eu-central-1', error: null });
    expect(status.components).toEqual([
      { name: 'Amazon EC2', status: 'degraded_performance' },
      { name: 'AWS Lambda', status: 'major_outage' },
    ]);
    expect(status.incidents[0]).toMatchObject({ name: 'Amazon EC2: Increased API latency', startedAt: new Date(1790240000 * 1000).toISOString() });
  });

  it('is quiet when the region has no events', () => {
    const status = parseAwsHealth(JSON.stringify(AWS_EVENTS), 'eu-west-1', { url: 'u', checkedAt: now });
    expect(status).toMatchObject({ indicator: 'none', description: 'No open events in eu-west-1', components: [] });
    expect(() => parseAwsHealth('{"not":"a list"}', 'eu-west-1', { url: 'u', checkedAt: now })).toThrow();
  });
});

describe('HCP Terraform workspaces', () => {
  it('joins workspaces with their current state version', () => {
    const raw = {
      data: [
        {
          id: 'ws-2',
          attributes: { name: 'syssoft-status', 'execution-mode': 'local', locked: true, 'resource-count': 7, 'updated-at': '2026-09-24T10:00:00Z' },
          relationships: { 'current-state-version': { data: { id: 'sv-9', type: 'state-versions' } } },
        },
        { id: 'ws-1', attributes: { name: 'syssoft-bootstrap' }, relationships: { 'current-state-version': { data: null } } },
      ],
      included: [{ id: 'sv-9', type: 'state-versions', attributes: { serial: 12, 'created-at': '2026-09-24T09:59:00Z' } }],
    };
    expect(parseTfWorkspaces(raw)).toEqual([
      { name: 'syssoft-bootstrap', executionMode: 'remote', locked: false, resourceCount: 0, stateSerial: null, stateCreatedAt: null, updatedAt: null },
      { name: 'syssoft-status', executionMode: 'local', locked: true, resourceCount: 7, stateSerial: 12, stateCreatedAt: '2026-09-24T09:59:00Z', updatedAt: '2026-09-24T10:00:00Z' },
    ]);
    expect(parseTfWorkspaces({})).toEqual([]);
  });
});

describe('integration events', () => {
  const status = (id: IntegrationStatus['id'], state: IntegrationStatus['ours']['state']): IntegrationStatus => {
    const { level, label } = integrationLevel({ state }, null);
    return { id, name: id, level, label, ours: { state, summary: 'x', hint: null, checkedAt: null, latencyMs: null, facts: [] }, vendor: null, checkedAt: 't' };
  };

  it('reports red transitions only', () => {
    expect(diffIntegrations(null, [status('github', 'auth_error')], now).events).toEqual([]);
    const down = diffIntegrations({ github: 'connected', aws: 'inactive' }, [status('github', 'unreachable'), status('aws', 'not_deployed')], now);
    expect(down.events.map((e) => e.kind)).toEqual(['integration.down']);
    expect(down.events[0]!.title).toContain('unreachable');
    expect(diffIntegrations(down.next, [status('github', 'unreachable')], now).events).toEqual([]);
    expect(diffIntegrations(down.next, [status('github', 'slow')], now).events.map((e) => e.kind)).toEqual(['integration.up']);
    expect(diffIntegrations({ github: 'connected' }, [status('github', 'slow')], now).events).toEqual([]);
  });
});
