import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { buildWrites, classify, describeError, expiresAt, hourStart, httpCheck, kyivDay, RETENTION_DAYS } from '../src/probe.mjs';

const ok = { httpStatus: 200, latencyMs: 30, tlsOk: true, tlsError: null, error: null, timedOut: false };

describe('classify', () => {
  test('2xx and 3xx are up', () => {
    assert.equal(classify(ok), 'operational');
    assert.equal(classify({ ...ok, httpStatus: 302 }), 'operational');
  });

  test('slow answers are degraded, not down', () => {
    assert.equal(classify({ ...ok, latencyMs: 2001 }), 'degraded');
    assert.equal(classify({ ...ok, latencyMs: 2000 }), 'operational');
    assert.equal(classify({ ...ok, latencyMs: 500 }, { degradedMs: 400 }), 'degraded');
  });

  test('5xx, unexpected 4xx, timeouts and connection errors are down', () => {
    assert.equal(classify({ ...ok, httpStatus: 503 }), 'down');
    assert.equal(classify({ ...ok, httpStatus: 404 }), 'down');
    assert.equal(classify({ ...ok, httpStatus: null, latencyMs: null, timedOut: true, error: 'timeout after 10000 ms' }), 'down');
    assert.equal(classify({ ...ok, httpStatus: null, latencyMs: null, error: 'ECONNREFUSED' }), 'down');
  });

  test('an expected 4xx is up', () => {
    assert.equal(classify({ ...ok, httpStatus: 401 }, { okStatuses: [401] }), 'operational');
  });

  test('TLS problems are not an outage', () => {
    assert.equal(classify({ ...ok, tlsOk: false, tlsError: 'CERT_HAS_EXPIRED' }), 'operational');
  });
});

describe('describeError', () => {
  test('uses the message, else the code, else the inner errors', () => {
    assert.equal(describeError(new Error('socket hang up')), 'socket hang up');
    assert.equal(describeError(Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
    const inner = [Object.assign(new Error(''), { code: 'ECONNREFUSED' }), Object.assign(new Error(''), { code: 'EHOSTUNREACH' })];
    assert.equal(describeError(new AggregateError(inner, '')), 'ECONNREFUSED, EHOSTUNREACH');
  });
});

describe('time helpers', () => {
  test('hour start is the UTC hour', () => {
    assert.equal(hourStart(new Date('2026-09-24T13:59:59.999Z')), '2026-09-24T13:00:00Z');
  });

  test('daily bucket follows the Kyiv calendar (UTC+3 in summer, UTC+2 in winter)', () => {
    assert.equal(kyivDay(new Date('2026-09-24T20:59:00Z')), '2026-09-24');
    assert.equal(kyivDay(new Date('2026-09-24T21:00:00Z')), '2026-09-25');
    assert.equal(kyivDay(new Date('2026-12-31T22:30:00Z')), '2027-01-01');
  });

  test('TTL is epoch seconds', () => {
    assert.equal(expiresAt(new Date('2026-01-01T00:00:00Z'), 1), 1767225600 + 86400);
  });
});

describe('buildWrites', () => {
  const checkedAt = new Date('2026-09-24T21:05:07.123Z');
  const base = { table: 't', targetId: 'knu-site', vantage: 'aws-eu-central-1', checkedAt };

  test('raw check item with all fields', () => {
    const { put } = buildWrites({ ...base, result: { ...ok, tlsOk: false, tlsError: 'CERT_HAS_EXPIRED' }, outcome: 'operational' });
    assert.equal(put.TableName, 't');
    assert.deepEqual(put.Item.pk, { S: 'check#knu-site' });
    assert.deepEqual(put.Item.sk, { S: '2026-09-24T21:05:07.123Z' });
    assert.deepEqual(put.Item.outcome, { S: 'operational' });
    assert.deepEqual(put.Item.httpStatus, { N: '200' });
    assert.deepEqual(put.Item.latencyMs, { N: '30' });
    assert.deepEqual(put.Item.tlsOk, { BOOL: false });
    assert.deepEqual(put.Item.tlsError, { S: 'CERT_HAS_EXPIRED' });
    assert.equal(put.Item.error, undefined);
    assert.deepEqual(put.Item.expiresAt, { N: String(expiresAt(checkedAt, RETENTION_DAYS.check)) });
  });

  test('a failed check has no status or latency attributes', () => {
    const result = { httpStatus: null, latencyMs: null, tlsOk: null, tlsError: null, error: 'timeout after 10000 ms', timedOut: true };
    const { put, updates } = buildWrites({ ...base, result, outcome: 'down' });
    assert.equal(put.Item.httpStatus, undefined);
    assert.equal(put.Item.latencyMs, undefined);
    assert.equal(put.Item.tlsOk, undefined);
    assert.deepEqual(put.Item.error, { S: 'timeout after 10000 ms' });
    assert.deepEqual(put.Item.timedOut, { BOOL: true });
    for (const update of updates) {
      assert.equal(update.UpdateExpression, 'ADD #total :one, #outcome :one SET #expiresAt = :expiresAt, #vantage = :vantage');
      assert.equal(update.ExpressionAttributeNames['#outcome'], 'down');
      assert.equal(update.ExpressionAttributeValues[':latency'], undefined);
    }
  });

  test('rollups: hourly by UTC hour, daily by Kyiv date, atomic counters', () => {
    const { updates } = buildWrites({ ...base, result: ok, outcome: 'operational' });
    const [hour, day] = updates;
    assert.deepEqual(hour.Key, { pk: { S: 'hour#knu-site' }, sk: { S: '2026-09-24T21:00:00Z' } });
    assert.deepEqual(day.Key, { pk: { S: 'day#knu-site' }, sk: { S: '2026-09-25' } });
    assert.equal(hour.UpdateExpression, 'ADD #total :one, #outcome :one, #latencySum :latency, #latencyCount :one SET #expiresAt = :expiresAt, #vantage = :vantage');
    assert.deepEqual(hour.ExpressionAttributeValues[':latency'], { N: '30' });
    assert.deepEqual(hour.ExpressionAttributeValues[':expiresAt'], { N: String(expiresAt(checkedAt, RETENTION_DAYS.hour)) });
    assert.deepEqual(day.ExpressionAttributeValues[':expiresAt'], { N: String(expiresAt(checkedAt, RETENTION_DAYS.day)) });
  });
});

describe('httpCheck against local servers', () => {
  let server;
  let base;
  let lastUserAgent;

  before(async () => {
    server = http.createServer((request, response) => {
      lastUserAgent = request.headers['user-agent'];
      if (request.url === '/ok') return response.end('hello');
      if (request.url === '/fail') return response.writeHead(503).end('down');
      if (request.url === '/redirect') return response.writeHead(302, { Location: '/elsewhere' }).end();
      if (request.url === '/big') {
        response.write(Buffer.alloc(64 * 1024));
        return; // never ends: the size cap must stop the check
      }
      if (request.url === '/hang') return; // never answers
      response.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  test('200 with latency, no TLS fields for plain http', async () => {
    const result = await httpCheck(`${base}/ok`);
    assert.equal(result.httpStatus, 200);
    assert.equal(typeof result.latencyMs, 'number');
    assert.equal(result.tlsOk, null);
    assert.equal(result.error, null);
    assert.equal(classify(result), 'operational');
  });

  test('503 is down', async () => {
    assert.equal(classify(await httpCheck(`${base}/fail`)), 'down');
  });

  test('redirects are not followed and count as up', async () => {
    const result = await httpCheck(`${base}/redirect`);
    assert.equal(result.httpStatus, 302);
    assert.equal(classify(result), 'operational');
  });

  test('body size cap ends the check', async () => {
    const result = await httpCheck(`${base}/big`, { maxBodyBytes: 16 * 1024, timeoutMs: 5000 });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.timedOut, false);
    assert.equal(classify(result), 'operational');
  });

  test('a server that never answers times out as down', async () => {
    const result = await httpCheck(`${base}/hang`, { timeoutMs: 200 });
    assert.equal(result.timedOut, true);
    assert.equal(result.error, 'timeout after 200 ms');
    assert.equal(classify(result), 'down');
  });

  test('a refused connection is down', async () => {
    // A port that was just freed: the connection is refused immediately (a random low port may be dropped instead)
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address();
    await new Promise((resolve) => closed.close(resolve));

    const result = await httpCheck(`http://127.0.0.1:${port}/`, { timeoutMs: 3000 });
    // ECONNREFUSED normally; ECONNRESET under WSL mirrored networking — either way a fast, readable failure
    assert.equal(result.timedOut, false);
    assert.match(result.error, /ECONN(REFUSED|RESET)/);
    assert.equal(classify(result), 'down');
  });

  test('invalid URL is down, not an exception', async () => {
    const result = await httpCheck('not a url');
    assert.equal(result.error, 'invalid URL: not a url');
    assert.equal(classify(result), 'down');
  });

  test('identifies itself with a User-Agent', async () => {
    await httpCheck(`${base}/ok`);
    assert.match(lastUserAgent, /^syssoft-labs-status\/1\.0 /);
  });
});

describe('httpCheck over TLS with a self-signed certificate', () => {
  let dir;
  let server;
  let url;
  let skip = false;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'probe-tls-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    } catch {
      skip = true;
      return;
    }
    server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
      (_request, response) => response.end('secure'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://127.0.0.1:${server.address().port}/`;
  });

  after(() => {
    server?.closeAllConnections();
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('records the TLS failure but the site is still up', async (t) => {
    if (skip) return t.skip('openssl not available');
    const result = await httpCheck(url);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.tlsOk, false);
    assert.match(result.tlsError, /SELF_SIGNED|self.signed|UNABLE_TO_VERIFY/i);
    assert.equal(classify(result), 'operational');
  });
});
