import type { QueryCommand, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import type { DbHandle } from '@labwatch/infra';
import { STATUS_TARGETS, type LabEvent, type StatusCheck } from '@labwatch/shared';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import type { CollectorConfig } from '../config.js';
import type { IncidentTracker } from '../infra/incidents.js';
import type { StatusStore } from '../infra/status-store.js';
import type { DynamoItem, QueryClient } from '../logic/aws-status.js';
import { AwsStatusSync, DynamoAwsProbeReader } from './aws-status.js';

const now = new Date('2026-09-24T12:00:00Z');
const aws: CollectorConfig['aws'] = {
  configured: true,
  region: 'eu-central-1',
  table: 'syssoft-labs-status-checks',
  vantage: 'aws-eu-central-1',
  syncIntervalMs: 120_000,
  backfillHours: 24,
};

function item(target: string, sk: string, outcome = 'operational', latencyMs = 200): DynamoItem {
  return {
    pk: { S: `check#${target}` },
    sk: { S: sk },
    vantage: { S: 'aws-eu-central-1' },
    outcome: { S: outcome },
    ...(outcome === 'down' ? { error: { S: 'timeout after 10000 ms' } } : { httpStatus: { N: '200' }, latencyMs: { N: String(latencyMs) } }),
  };
}

/** Answers every query from a per-target list of items, honouring `sk > :after`, Limit and paging. */
function tableClient(rows: Record<string, DynamoItem[]>, failWith?: Error): QueryClient & { inputs: QueryCommand['input'][] } {
  const inputs: QueryCommand['input'][] = [];
  return {
    inputs,
    async send(command: QueryCommand) {
      inputs.push(command.input);
      if (failWith) throw failWith;
      const { ExpressionAttributeValues: v = {}, ScanIndexForward, Limit = 50, ExclusiveStartKey } = command.input;
      const target = v[':pk']!.S!.slice('check#'.length);
      const after = v[':after']?.S;
      let items = (rows[target] ?? []).filter((i) => !after || i['sk']!.S! > after);
      items = ScanIndexForward === false ? [...items].reverse() : items;
      const start = ExclusiveStartKey ? items.findIndex((i) => i['sk']!.S === ExclusiveStartKey['sk']!.S) + 1 : 0;
      const page = items.slice(start, start + Limit);
      const last = page.at(-1);
      return {
        Items: page,
        ...(start + Limit < items.length && last ? { LastEvaluatedKey: { pk: last['pk']!, sk: last['sk']! } } : {}),
      } as QueryCommandOutput;
    },
  };
}

describe('DynamoAwsProbeReader (AWS card)', () => {
  it('is Connected with the newest check of every site', async () => {
    const client = tableClient({
      'univ-syssoft': [item('univ-syssoft', '2026-09-24T11:58:50.000Z'), item('univ-syssoft', '2026-09-24T11:59:50.000Z', 'operational', 270)],
      'univ-root': [item('univ-root', '2026-09-24T11:59:50.000Z', 'operational', 256)],
      'knu-site': [item('knu-site', '2026-09-24T11:59:50.000Z', 'down')],
      'knu-triton': [item('knu-triton', '2026-09-24T11:59:50.000Z', 'operational', 321)],
    });
    const card = await new DynamoAwsProbeReader(client, aws, () => now).latest();

    expect(card).toMatchObject({ state: 'connected', summary: 'Last check 10 s ago · 3/4 sites up' });
    expect(card.facts).toContainEqual({ label: 'System software course page', value: 'operational, 270 ms' });
    expect(card.facts).toContainEqual({ label: 'knu.ua', value: 'down' });
    expect(client.inputs).toHaveLength(STATUS_TARGETS.length);
    expect(client.inputs.every((i) => i.ScanIndexForward === false && i.Limit === 1)).toBe(true);
  });

  it('is Degraded when the prober is late and reports auth errors by name', async () => {
    const late = tableClient({ 'knu-site': [item('knu-site', '2026-09-24T11:55:00.000Z')] });
    expect((await new DynamoAwsProbeReader(late, aws, () => now).latest()).state).toBe('slow');

    const denied = Object.assign(new Error('The security token included in the request is invalid.'), { name: 'UnrecognizedClientException' });
    const card = await new DynamoAwsProbeReader(tableClient({}, denied), aws, () => now).latest();
    expect(card).toMatchObject({ state: 'auth_error', summary: 'UnrecognizedClientException: The security token included in the request is invalid.' });
  });
});

describe('AwsStatusSync', () => {
  function harness(rows: Record<string, DynamoItem[]>) {
    const stored = new Map<string, StatusCheck>(); // key: target|vantage|time
    const redis = new Map<string, string>();
    const hashes = new Map<string, Record<string, string>>();
    const applied: StatusCheck[] = [];
    const emitted: LabEvent[] = [];
    const published: string[] = [];

    const db = {
      pool: {
        async query(text: string, values: unknown[]) {
          if (text.includes('insert into status_checks')) {
            const [targets, vantages, times, outcomes] = values as string[][];
            let n = 0;
            targets!.forEach((target, i) => {
              const key = `${target}|${vantages![i]}|${times![i]}`;
              if (!stored.has(key)) {
                stored.set(key, { target, vantage: vantages![i]!, checkedAt: times![i]!, outcome: outcomes![i] as StatusCheck['outcome'] } as StatusCheck);
                n++;
              }
            });
            return { rows: [{ n }] };
          }
          if (text.includes('max(checked_at)')) {
            const [target, vantage] = values as string[];
            const times = [...stored.values()].filter((c) => c.target === target && c.vantage === vantage).map((c) => c.checkedAt).sort();
            return { rows: [{ at: times.length ? new Date(times.at(-1)!) : null }] };
          }
          throw new Error(`unexpected SQL: ${text}`);
        },
      },
    } as unknown as DbHandle;
    const fakeRedis = {
      async get(key: string) {
        return redis.get(key) ?? null;
      },
      async set(key: string, value: string) {
        redis.set(key, value);
        return 'OK';
      },
      async hset(key: string, value: Record<string, string>) {
        hashes.set(key, { ...hashes.get(key), ...value });
        return 1;
      },
    } as unknown as Redis;
    const store = {
      async emit(events: LabEvent[]) {
        emitted.push(...events);
      },
      async publish(topic: string) {
        published.push(topic);
      },
    } as unknown as StatusStore;
    const incidents = {
      async apply(target: { id: string; name: string; url: string }, check: StatusCheck) {
        applied.push(check);
        return check.outcome === 'down' ? ({ kind: 'status.down', severity: 'error', title: `${target.name} down`, at: check.checkedAt, data: {} } as LabEvent) : null;
      },
    } as unknown as IncidentTracker;
    const client = tableClient(rows);
    const sync = new AwsStatusSync({ aws } as CollectorConfig, db, fakeRedis, client, store, incidents);
    return { sync, client, stored, redis, hashes, applied, emitted, published };
  }

  it('backfills at most the configured window on the first run, then continues from the cursor', async () => {
    const old = item('knu-site', '2026-09-22T12:00:00.000Z'); // older than 24 h: not backfilled
    const recent = Array.from({ length: 3 }, (_, i) => item('knu-site', `2026-09-24T11:5${7 + i}:00.000Z`));
    const h = harness({ 'knu-site': [old, ...recent] });

    const first = await h.sync.syncOnce(now);
    expect(first).toEqual({ inserted: 3, more: false });
    expect(h.client.inputs.find((i) => i.ExpressionAttributeValues![':pk']!.S === 'check#knu-site')?.ExpressionAttributeValues![':after']?.S).toBe(
      '2026-09-23T12:00:00.000Z',
    );
    expect(h.redis.get('aws:sync:knu-site')).toBe('2026-09-24T11:59:00.000Z');
    expect(JSON.parse(h.hashes.get('status:checks:aws-eu-central-1')!['knu-site']!)).toMatchObject({ checkedAt: '2026-09-24T11:59:00.000Z', vantage: 'aws-eu-central-1' });
    expect(h.published).toEqual(['status']);

    // Next round: only newer items are read, nothing is inserted twice
    h.client.inputs.length = 0;
    const second = await h.sync.syncOnce(now);
    expect(second).toEqual({ inserted: 0, more: false });
    expect(h.client.inputs.find((i) => i.ExpressionAttributeValues![':pk']!.S === 'check#knu-site')?.ExpressionAttributeValues![':after']?.S).toBe(
      '2026-09-24T11:59:00.000Z',
    );
  });

  it('continues from the newest stored check after Redis lost the cursor, idempotently', async () => {
    const items = [item('knu-site', '2026-09-24T11:58:00.000Z'), item('knu-site', '2026-09-24T11:59:00.000Z')];
    const h = harness({ 'knu-site': items });
    await h.sync.syncOnce(now);
    h.redis.clear();
    const again = await h.sync.syncOnce(now);
    expect(again.inserted).toBe(0);
    expect(h.stored.size).toBe(2);
  });

  it('applies incidents in time order but only raises events for recent checks', async () => {
    const h = harness({
      'knu-site': [item('knu-site', '2026-09-24T09:00:00.000Z', 'down'), item('knu-site', '2026-09-24T11:59:00.000Z', 'down')],
    });
    await h.sync.syncOnce(now);
    expect(h.applied.map((c) => c.checkedAt)).toEqual(['2026-09-24T09:00:00.000Z', '2026-09-24T11:59:00.000Z']);
    expect(h.emitted.map((e) => e.at)).toEqual(['2026-09-24T11:59:00.000Z']); // the 3-hour-old one is history, not news
  });

  it('says when a site has more checks than one round reads', async () => {
    const many = Array.from({ length: 1600 }, (_, i) => item('knu-site', new Date(now.getTime() - (1600 - i) * 50_000).toISOString()));
    const h = harness({ 'knu-site': many });
    const result = await h.sync.syncOnce(now);
    expect(result.more).toBe(true);
    expect(result.inserted).toBe(1500); // 30 pages × 50
  });
});
