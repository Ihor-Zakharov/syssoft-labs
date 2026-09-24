import type { QueryCommand, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  AWS_FRESH_MS,
  awsConnection,
  awsErrorConnection,
  checkFromItem,
  classifyAwsError,
  freshness,
  queryChecks,
  type DynamoItem,
  type QueryClient,
} from './aws-status.js';

const now = new Date('2026-09-24T12:00:00Z');

/** An item exactly as the Lambda prober writes it (probe.mjs buildWrites). */
function item(sk: string, outcome = 'operational', extra: DynamoItem = {}): DynamoItem {
  return {
    pk: { S: 'check#knu-site' },
    sk: { S: sk },
    vantage: { S: 'aws-eu-central-1' },
    outcome: { S: outcome },
    timedOut: { BOOL: false },
    expiresAt: { N: '1800000000' },
    ...extra,
  };
}

function awsError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

/** Fake DynamoDB: answers pages from a queue of outputs/errors and records every query input. */
function fakeClient(responses: Array<Partial<QueryCommandOutput> | Error>): QueryClient & { inputs: QueryCommand['input'][] } {
  const inputs: QueryCommand['input'][] = [];
  return {
    inputs,
    async send(command: QueryCommand) {
      inputs.push(command.input);
      const next = responses.shift();
      if (!next) throw new Error('unexpected query');
      if (next instanceof Error) throw next;
      return next as QueryCommandOutput;
    },
  };
}

describe('checkFromItem', () => {
  it('maps a prober item to a StatusCheck', () => {
    const check = checkFromItem(
      item('2026-09-24T11:59:10.701Z', 'operational', { httpStatus: { N: '200' }, latencyMs: { N: '256' }, tlsOk: { BOOL: false }, tlsError: { S: 'CERT_HAS_EXPIRED' } }),
      'knu-site',
      'fallback',
    );
    expect(check).toEqual({
      target: 'knu-site',
      vantage: 'aws-eu-central-1',
      checkedAt: '2026-09-24T11:59:10.701Z',
      outcome: 'operational',
      httpStatus: 200,
      latencyMs: 256,
      tlsOk: false,
      tlsError: 'CERT_HAS_EXPIRED',
      error: null,
    });
  });

  it('keeps a failed check and ignores anything that is not a check', () => {
    expect(checkFromItem(item('2026-09-24T11:59:10.701Z', 'down', { error: { S: 'timeout after 10000 ms' } }), 'knu-site', 'v')).toMatchObject({
      outcome: 'down',
      httpStatus: null,
      latencyMs: null,
      tlsOk: null,
      error: 'timeout after 10000 ms',
    });
    expect(checkFromItem({ pk: { S: 'hour#knu-site' }, sk: { S: '2026-09-24T11:00' }, total: { N: '60' } }, 'knu-site', 'v')).toBeNull();
    expect(checkFromItem(item('not a date'), 'knu-site', 'v')).toBeNull();
    expect(checkFromItem(item('2026-09-24T11:59:10.701Z', 'sideways'), 'knu-site', 'v')).toBeNull();
    expect(checkFromItem({ ...item('2026-09-24T11:59:10.701Z'), vantage: undefined as never }, 'knu-site', 'fallback')?.vantage).toBe('fallback');
  });
});

describe('AWS errors and freshness', () => {
  it('classifies SDK errors', () => {
    expect(classifyAwsError(awsError('UnrecognizedClientException', 'The security token included in the request is invalid.'))).toEqual({
      state: 'auth_error',
      name: 'UnrecognizedClientException',
      message: 'The security token included in the request is invalid.',
    });
    expect(classifyAwsError(awsError('AccessDeniedException')).state).toBe('auth_error');
    expect(classifyAwsError(awsError('InvalidSignatureException')).state).toBe('auth_error');
    expect(classifyAwsError(awsError('ProvisionedThroughputExceededException')).state).toBe('slow');
    expect(classifyAwsError(awsError('ResourceNotFoundException')).state).toBe('unreachable');
    expect(classifyAwsError(Object.assign(new Error('getaddrinfo ENOTFOUND dynamodb.eu-central-1.amazonaws.com'), { name: 'Error' })).state).toBe('unreachable');
    expect(classifyAwsError('weird').state).toBe('unreachable');
  });

  it('turns the age of the newest check into a state', () => {
    expect(freshness(null, now)).toBe('unreachable');
    expect(freshness(new Date(now.getTime() - 60_000), now)).toBe('connected');
    expect(freshness(new Date(now.getTime() - AWS_FRESH_MS), now)).toBe('slow');
    expect(freshness(new Date(now.getTime() - 9 * 60_000), now)).toBe('slow');
    expect(freshness(new Date(now.getTime() - 10 * 60_000), now)).toBe('unreachable');
  });

  it('builds the card from the newest check per site', () => {
    const names = new Map([['knu-site', 'knu.ua'], ['univ-root', 'Server home page']]);
    const at = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
    const check = (target: string, secondsAgo: number, outcome: 'operational' | 'down', latencyMs: number | null) => ({
      target, vantage: 'aws-eu-central-1', checkedAt: at(secondsAgo), outcome, httpStatus: 200, latencyMs, tlsOk: true, tlsError: null, error: null,
    });
    const card = awsConnection({
      latest: [check('knu-site', 42, 'operational', 321), check('univ-root', 50, 'down', null)],
      names,
      now,
      queryLatencyMs: 35,
      region: 'eu-central-1',
      table: 'syssoft-labs-status-checks',
    });
    expect(card).toMatchObject({ state: 'connected', summary: 'Last check 42 s ago · 1/2 sites up', hint: null, latencyMs: 35 });
    expect(card.facts).toEqual([
      { label: 'Region', value: 'eu-central-1' },
      { label: 'Table', value: 'syssoft-labs-status-checks' },
      { label: 'Last check', value: '2026-09-24T11:59:18Z (42 s ago)' },
      { label: 'knu.ua', value: 'operational, 321 ms' },
      { label: 'Server home page', value: 'down' },
    ]);

    const late = awsConnection({ latest: [check('knu-site', 5 * 60, 'operational', 1)], names, now, queryLatencyMs: 1, region: 'r', table: 't' });
    expect(late).toMatchObject({ state: 'slow', summary: 'The AWS prober is late: last check 5 min ago' });
    expect(late.hint).toContain('/aws/lambda/syssoft-labs-status-prober');
    const empty = awsConnection({ latest: [], names, now, queryLatencyMs: 1, region: 'r', table: 't' });
    expect(empty).toMatchObject({ state: 'unreachable', summary: 'The table has no checks from the AWS prober' });
  });

  it('explains a failed read', () => {
    const auth = awsErrorConnection(classifyAwsError(awsError('UnrecognizedClientException', 'invalid token')), { now, region: 'eu-central-1', table: 't' });
    expect(auth).toMatchObject({ state: 'auth_error', summary: 'UnrecognizedClientException: invalid token' });
    expect(auth.hint).toContain('syssoft-labs-labwatch-reader');
    const missing = awsErrorConnection(classifyAwsError(awsError('ResourceNotFoundException', 'no table')), { now, region: 'us-east-1', table: 't' });
    expect(missing.hint).toContain('AWS_REGION (us-east-1)');
  });
});

describe('queryChecks', () => {
  const noSleep = vi.fn(async () => {});

  it('pages through the newer checks of one site', async () => {
    const client = fakeClient([
      { Items: [item('2026-09-24T11:00:00.000Z'), item('2026-09-24T11:01:00.000Z')], LastEvaluatedKey: { pk: { S: 'check#knu-site' }, sk: { S: '2026-09-24T11:01:00.000Z' } } },
      { Items: [item('2026-09-24T11:02:00.000Z')] },
    ]);
    const result = await queryChecks(client, { table: 't', targetId: 'knu-site', afterSk: '2026-09-24T10:59:00.000Z', limit: 2, maxPages: 10, sleep: noSleep });

    expect(result).toMatchObject({ pages: 2, truncated: false });
    expect(result.items).toHaveLength(3);
    expect(client.inputs[0]).toMatchObject({
      TableName: 't',
      KeyConditionExpression: 'pk = :pk AND sk > :after',
      ExpressionAttributeValues: { ':pk': { S: 'check#knu-site' }, ':after': { S: '2026-09-24T10:59:00.000Z' } },
      ScanIndexForward: true,
      Limit: 2,
    });
    expect(client.inputs[0]).not.toHaveProperty('ExclusiveStartKey');
    expect(client.inputs[1]?.ExclusiveStartKey).toEqual({ pk: { S: 'check#knu-site' }, sk: { S: '2026-09-24T11:01:00.000Z' } });
  });

  it('stops after maxPages and says there is more', async () => {
    const more = { Items: [item('2026-09-24T11:00:00.000Z')], LastEvaluatedKey: { pk: { S: 'x' }, sk: { S: 'y' } } };
    const client = fakeClient([more, more]);
    const result = await queryChecks(client, { table: 't', targetId: 'knu-site', limit: 1, maxPages: 2, sleep: noSleep });
    expect(result).toMatchObject({ pages: 2, truncated: true });
    expect(client.inputs[0]?.KeyConditionExpression).toBe('pk = :pk');
  });

  it('reads the newest check first when asked', async () => {
    const client = fakeClient([{ Items: [item('2026-09-24T11:59:00.000Z')] }]);
    await queryChecks(client, { table: 't', targetId: 'knu-site', newestFirst: true, limit: 1, maxPages: 1, sleep: noSleep });
    expect(client.inputs[0]).toMatchObject({ ScanIndexForward: false, Limit: 1 });
  });

  it('backs off exponentially when throttled, then continues', async () => {
    const sleep = vi.fn(async () => {});
    const client = fakeClient([
      awsError('ProvisionedThroughputExceededException'),
      awsError('ProvisionedThroughputExceededException'),
      { Items: [item('2026-09-24T11:00:00.000Z')] },
    ]);
    const result = await queryChecks(client, { table: 't', targetId: 'knu-site', limit: 50, maxPages: 5, sleep });
    expect(result.items).toHaveLength(1);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it('gives up after the retries, and never retries other errors', async () => {
    const throttled = Array.from({ length: 3 }, () => awsError('ThrottlingException'));
    await expect(queryChecks(fakeClient(throttled), { table: 't', targetId: 'x', limit: 1, maxPages: 1, maxRetries: 2, sleep: noSleep })).rejects.toThrow(
      'ThrottlingException',
    );
    const denied = fakeClient([awsError('AccessDeniedException', 'not allowed')]);
    await expect(queryChecks(denied, { table: 't', targetId: 'x', limit: 1, maxPages: 1, sleep: noSleep })).rejects.toThrow('not allowed');
    expect(denied.inputs).toHaveLength(1);
  });
});
