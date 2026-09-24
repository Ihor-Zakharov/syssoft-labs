// Pure logic of the prober: one HTTP check, its classification and the DynamoDB writes it produces.
// No AWS SDK here, so it runs and is tested with plain `node`.
import http from 'node:http';
import https from 'node:https';

export const DEFAULTS = Object.freeze({
  timeoutMs: 10_000,
  degradedMs: 2_000,
  maxBodyBytes: 512 * 1024,
  userAgent: 'syssoft-labs-status/1.0 (+https://github.com/Ihor-Zakharov/syssoft-labs)',
});

/** How long items live before DynamoDB's TTL deletes them. */
export const RETENTION_DAYS = Object.freeze({ check: 120, hour: 120, day: 400 });

const DAY_SECONDS = 86_400;

/**
 * Readable reason for a network error. Connection failures can come as an AggregateError
 * (one error per tried address) whose message is empty and whose code carries the reason.
 */
export function describeError(error) {
  if (error.message) return error.message;
  if (error.code) return error.code;
  const inner = error.errors?.map((e) => e.code ?? e.message).filter(Boolean);
  return inner?.length ? inner.join(', ') : String(error);
}

/**
 * One availability check with a single deadline for connect + TLS + headers + body.
 * Redirects are not followed (a 3xx answer means the server is up). TLS validation is recorded,
 * not enforced: a site with an expired certificate is still reachable for its users.
 */
export function httpCheck(url, options = {}) {
  const { timeoutMs, maxBodyBytes, userAgent } = { ...DEFAULTS, ...options };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let tlsOk = null;
    let tlsError = null;
    let deadline;
    let request;

    const finish = (partial) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ httpStatus: null, latencyMs: null, tlsOk, tlsError, error: null, timedOut, ...partial });
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish({ error: `invalid URL: ${url}` });
      return;
    }
    const secure = parsed.protocol === 'https:';

    request = (secure ? https : http).get(
      parsed,
      {
        agent: false, // fresh connection: every check measures connect + TLS handshake
        headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*' },
        ...(secure ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        if (secure) {
          tlsOk = response.socket.authorized === true;
          tlsError = tlsOk ? null : String(response.socket.authorizationError ?? 'TLS validation failed');
        }
        const httpStatus = response.statusCode ?? null;
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            // Enough to know the page is served; don't download a huge body every minute
            finish({ httpStatus, latencyMs: elapsed() });
            response.destroy();
          }
        });
        response.on('end', () => finish({ httpStatus, latencyMs: elapsed() }));
        response.on('error', (error) => finish({ httpStatus, error: timedOut ? `timeout after ${timeoutMs} ms` : describeError(error) }));
        response.on('close', () => finish({ httpStatus, error: timedOut ? `timeout after ${timeoutMs} ms` : 'connection closed before the body ended' }));
      },
    );
    request.on('error', (error) => finish({ error: timedOut ? `timeout after ${timeoutMs} ms` : describeError(error) }));

    deadline = setTimeout(() => {
      timedOut = true;
      request.destroy(new Error(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });
}

/**
 * Same rules as labwatch: down = timeout, connection error, 5xx, unexpected 4xx;
 * degraded = answered but slower than the threshold; TLS problems are NOT an outage.
 */
export function classify(result, { degradedMs = DEFAULTS.degradedMs, okStatuses = [] } = {}) {
  if (result.timedOut || result.error !== null || result.httpStatus === null) return 'down';
  const status = result.httpStatus;
  const ok = (status >= 200 && status < 400) || okStatuses.includes(status);
  if (!ok) return 'down';
  return result.latencyMs !== null && result.latencyMs > degradedMs ? 'degraded' : 'operational';
}

const kyivDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Kyiv ("2026-09-25"), so daily bars match what the user sees on the clock. */
export function kyivDay(date) {
  return kyivDateFormat.format(date);
}

/** Start of the UTC hour, e.g. "2026-09-24T13:00:00Z" (Kyiv's offset is a whole number of hours). */
export function hourStart(date) {
  const start = new Date(date);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString().replace('.000Z', 'Z');
}

export function expiresAt(date, days) {
  return Math.floor(date.getTime() / 1000) + days * DAY_SECONDS;
}

const S = (value) => ({ S: String(value) });
const N = (value) => ({ N: String(value) });
const BOOL = (value) => ({ BOOL: value });

/**
 * DynamoDB writes for one check (low-level attribute maps for @aws-sdk/client-dynamodb):
 *  - put:     raw check          pk "check#<target>", sk ISO time
 *  - updates: hourly rollup      pk "hour#<target>",  sk hour start (UTC)
 *             daily rollup       pk "day#<target>",   sk Kyiv date
 * Rollups are atomic ADD counters, so concurrent or late writes never lose a check.
 */
export function buildWrites({ table, targetId, vantage, checkedAt, result, outcome }) {
  const item = {
    pk: S(`check#${targetId}`),
    sk: S(checkedAt.toISOString()),
    vantage: S(vantage),
    outcome: S(outcome),
    timedOut: BOOL(result.timedOut),
    expiresAt: N(expiresAt(checkedAt, RETENTION_DAYS.check)),
  };
  if (result.httpStatus !== null) item.httpStatus = N(result.httpStatus);
  if (result.latencyMs !== null) item.latencyMs = N(result.latencyMs);
  if (result.tlsOk !== null) item.tlsOk = BOOL(result.tlsOk);
  if (result.tlsError !== null) item.tlsError = S(result.tlsError);
  if (result.error !== null) item.error = S(result.error);

  const rollup = (prefix, sortKey, days) => {
    const names = { '#total': 'total', '#outcome': outcome, '#expiresAt': 'expiresAt', '#vantage': 'vantage' };
    const values = { ':one': N(1), ':expiresAt': N(expiresAt(checkedAt, days)), ':vantage': S(vantage) };
    const add = ['#total :one', '#outcome :one'];
    if (result.latencyMs !== null) {
      names['#latencySum'] = 'latencySum';
      names['#latencyCount'] = 'latencyCount';
      values[':latency'] = N(result.latencyMs);
      add.push('#latencySum :latency', '#latencyCount :one');
    }
    return {
      TableName: table,
      Key: { pk: S(`${prefix}#${targetId}`), sk: S(sortKey) },
      UpdateExpression: `ADD ${add.join(', ')} SET #expiresAt = :expiresAt, #vantage = :vantage`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  };

  return {
    put: { TableName: table, Item: item },
    updates: [
      rollup('hour', hourStart(checkedAt), RETENTION_DAYS.hour),
      rollup('day', kyivDay(checkedAt), RETENTION_DAYS.day),
    ],
  };
}
