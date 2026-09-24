// Local dry run: probe the real targets from this machine with the Lambda's logic, print the
// classification and the DynamoDB writes that would be made. Nothing is written anywhere.
//   node infra/aws/status/lambda/tools/dry-run.mjs [--writes]
import { readFileSync } from 'node:fs';
import { buildWrites, classify, httpCheck } from '../src/probe.mjs';

const targets = JSON.parse(readFileSync(new URL('../../targets.json', import.meta.url), 'utf8'));
const showWrites = process.argv.includes('--writes');
const checkedAt = new Date();

const rows = await Promise.all(
  targets.map(async (target) => {
    const result = await httpCheck(target.url);
    const outcome = classify(result, { okStatuses: target.okStatuses ?? [] });
    if (showWrites) {
      const writes = buildWrites({ table: 'syssoft-labs-status-checks', targetId: target.id, vantage: 'dry-run', checkedAt, result, outcome });
      console.log(JSON.stringify({ target: target.id, ...writes }, null, 2));
    }
    return {
      target: target.id,
      outcome,
      http: result.httpStatus ?? '-',
      latencyMs: result.latencyMs ?? '-',
      tls: result.tlsOk === null ? '-' : result.tlsOk ? 'ok' : result.tlsError,
      error: result.error ?? '',
    };
  }),
);
console.table(rows);
