import { QueryCommand, type AttributeValue, type QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { STATUS_OUTCOMES, type ConnectionState, type OurConnection, type StatusCheck, type StatusOutcome } from '@labwatch/shared';

export type DynamoItem = Record<string, AttributeValue>;

/** Anything that can send a QueryCommand — the real DynamoDBClient or a fake in tests. */
export interface QueryClient {
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

/** Newest check younger than this → Connected; up to STALE → the prober is late (Degraded); older → Unreachable. */
export const AWS_FRESH_MS = 3 * 60_000;
export const AWS_STALE_MS = 10 * 60_000;

const THROTTLED = new Set(['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded']);
const AUTH = new Set([
  'AccessDeniedException',
  'UnrecognizedClientException',
  'InvalidSignatureException',
  'IncompleteSignatureException',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'MissingAuthenticationTokenException',
  'CredentialsProviderError',
]);

/**
 * A raw check item written by the Lambda prober (pk `check#<target>`, sk = ISO time) as a StatusCheck.
 * Returns null for anything that does not look like one (rollup items, missing fields).
 */
export function checkFromItem(item: DynamoItem, targetId: string, fallbackVantage: string): StatusCheck | null {
  const sk = item['sk']?.S;
  const outcome = item['outcome']?.S;
  if (!sk || Number.isNaN(Date.parse(sk)) || !outcome || !(STATUS_OUTCOMES as readonly string[]).includes(outcome)) return null;
  const num = (a: AttributeValue | undefined) => (a?.N !== undefined && a.N !== '' ? Number(a.N) : null);
  return {
    target: targetId,
    vantage: item['vantage']?.S ?? fallbackVantage,
    checkedAt: new Date(sk).toISOString(),
    outcome: outcome as StatusOutcome,
    httpStatus: num(item['httpStatus']),
    latencyMs: num(item['latencyMs']),
    tlsOk: item['tlsOk']?.BOOL ?? null,
    tlsError: item['tlsError']?.S ?? null,
    error: item['error']?.S ?? null,
  };
}

export interface AwsErrorInfo {
  state: Extract<ConnectionState, 'auth_error' | 'unreachable' | 'slow'>;
  name: string;
  message: string;
}

/** SDK error → card state. Names and messages never contain credentials (at most the IAM user's ARN). */
export function classifyAwsError(error: unknown): AwsErrorInfo {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  if (AUTH.has(name)) return { state: 'auth_error', name, message };
  if (THROTTLED.has(name)) return { state: 'slow', name, message };
  return { state: 'unreachable', name, message };
}

export function isThrottled(error: unknown): boolean {
  return error instanceof Error && THROTTLED.has(error.name);
}

export function freshness(newest: Date | null, now: Date): Extract<ConnectionState, 'connected' | 'slow' | 'unreachable'> {
  if (!newest) return 'unreachable';
  const age = now.getTime() - newest.getTime();
  if (age < AWS_FRESH_MS) return 'connected';
  return age < AWS_STALE_MS ? 'slow' : 'unreachable';
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** The AWS card's "our connection" from the newest check of every target. */
export function awsConnection(args: {
  latest: readonly StatusCheck[];
  names: ReadonlyMap<string, string>;
  now: Date;
  queryLatencyMs: number;
  region: string;
  table: string;
}): OurConnection {
  const { latest, now } = args;
  const newest = latest.reduce<Date | null>((max, c) => {
    const at = new Date(c.checkedAt);
    return !max || at > max ? at : max;
  }, null);
  const state = freshness(newest, now);
  const up = latest.filter((c) => c.outcome !== 'down').length;
  const age = newest ? ago(now.getTime() - newest.getTime()) : null;
  const summary = !newest
    ? 'The table has no checks from the AWS prober'
    : state === 'connected'
      ? `Last check ${age} · ${up}/${latest.length} sites up`
      : state === 'slow'
        ? `The AWS prober is late: last check ${age}`
        : `No checks from the AWS prober since ${age}`;
  return {
    state,
    summary,
    hint:
      state === 'connected'
        ? null
        : 'The Lambda runs every minute from EventBridge Scheduler; look at its log group /aws/lambda/syssoft-labs-status-prober.',
    checkedAt: now.toISOString(),
    latencyMs: args.queryLatencyMs,
    facts: [
      { label: 'Region', value: args.region },
      { label: 'Table', value: args.table },
      ...(newest ? [{ label: 'Last check', value: `${newest.toISOString().replace('.000Z', 'Z')} (${age})` }] : []),
      ...latest.map((c) => ({
        label: args.names.get(c.target) ?? c.target,
        value: `${c.outcome}${c.latencyMs !== null ? `, ${c.latencyMs} ms` : ''}`,
      })),
    ],
  };
}

/** The card when the read failed: which error, and what to check. */
export function awsErrorConnection(info: AwsErrorInfo, args: { now: Date; region: string; table: string }): OurConnection {
  const hint =
    info.state === 'auth_error'
      ? 'Check the access key of the IAM user syssoft-labs-labwatch-reader in .env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).'
      : info.name === 'ResourceNotFoundException'
        ? `Table ${args.table} not found — check AWS_REGION (${args.region}) and AWS_STATUS_TABLE.`
        : info.state === 'slow'
          ? 'DynamoDB throttled the read (the table has 3 read units); the next round retries.'
          : null;
  return {
    state: info.state,
    summary: `${info.name}: ${info.message}`,
    hint,
    checkedAt: args.now.toISOString(),
    latencyMs: null,
    facts: [
      { label: 'Region', value: args.region },
      { label: 'Table', value: args.table },
    ],
  };
}

export interface QueryChecksOptions {
  table: string;
  targetId: string;
  /** Only checks after this ISO time (exclusive); otherwise all. */
  afterSk?: string;
  newestFirst?: boolean;
  limit: number;
  maxPages: number;
  /** Retries of a throttled page (the SDK retries too; this adds a longer pause). */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Pages through `check#<target>` items. Stops after maxPages (the caller continues next round from
 * the last item it got), backs off exponentially when DynamoDB throttles (only 3 read units).
 */
export async function queryChecks(client: QueryClient, options: QueryChecksOptions): Promise<{ items: DynamoItem[]; pages: number; truncated: boolean }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 5;
  const items: DynamoItem[] = [];
  let startKey: DynamoItem | undefined;
  let pages = 0;

  while (pages < options.maxPages) {
    const values: DynamoItem = { ':pk': { S: `check#${options.targetId}` } };
    if (options.afterSk) values[':after'] = { S: options.afterSk };
    const command = new QueryCommand({
      TableName: options.table,
      KeyConditionExpression: options.afterSk ? 'pk = :pk AND sk > :after' : 'pk = :pk',
      ExpressionAttributeValues: values,
      ScanIndexForward: !options.newestFirst,
      Limit: options.limit,
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    });

    let output: QueryCommandOutput | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        output = await client.send(command);
        break;
      } catch (error) {
        if (!isThrottled(error) || attempt >= maxRetries) throw error;
        await sleep(250 * 2 ** attempt);
      }
    }

    pages++;
    items.push(...(output.Items ?? []));
    startKey = output.LastEvaluatedKey;
    if (!startKey) return { items, pages, truncated: false };
  }
  return { items, pages, truncated: true };
}
