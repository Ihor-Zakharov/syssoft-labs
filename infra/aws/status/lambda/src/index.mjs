// Lambda entry point: probe every target once, store the raw check and update the hourly/daily rollups.
// Invoked by EventBridge Scheduler every minute. The AWS SDK v3 comes with the Node.js runtime.
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { buildWrites, classify, DEFAULTS, httpCheck } from './probe.mjs';

const client = new DynamoDBClient({});

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`environment variable ${name} is not set`);
  return value;
}

const table = requireEnv('TABLE_NAME');
const vantage = requireEnv('VANTAGE');
const targets = JSON.parse(requireEnv('TARGETS_JSON'));
const degradedMs = Number(process.env.DEGRADED_MS ?? DEFAULTS.degradedMs);

async function checkTarget(target, checkedAt) {
  const result = await httpCheck(target.url);
  const outcome = classify(result, { degradedMs, okStatuses: target.okStatuses ?? [] });
  const writes = buildWrites({ table, targetId: target.id, vantage, checkedAt, result, outcome });

  await client.send(new PutItemCommand(writes.put));
  await Promise.all(writes.updates.map((update) => client.send(new UpdateItemCommand(update))));

  // One structured log line per check (CloudWatch Logs keeps them for 3 days)
  console.log(JSON.stringify({ target: target.id, outcome, ...result }));
  return { target: target.id, outcome };
}

export async function handler() {
  const checkedAt = new Date();
  const settled = await Promise.allSettled(targets.map((target) => checkTarget(target, checkedAt)));

  const failed = settled.filter((s) => s.status === 'rejected');
  for (const failure of failed) console.error(JSON.stringify({ error: String(failure.reason) }));
  // Fail the invocation so the Errors metric shows it; no retries are configured, so nothing is counted twice
  if (failed.length > 0) throw new Error(`${failed.length} of ${targets.length} checks could not be stored`);

  return { checkedAt: checkedAt.toISOString(), results: settled.map((s) => s.value) };
}
