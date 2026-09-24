import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpCheck } from './http-check.js';
import { classifyCheck, failureReason, formatDuration, incidentAction, statusDownEvent, statusUpEvent } from './status-check.js';

const ok = { httpStatus: 200, latencyMs: 120, error: null, timedOut: false };

describe('classifyCheck', () => {
  const opts = { degradedMs: 2000 };

  it('is operational for fast 2xx/3xx answers', () => {
    expect(classifyCheck(ok, opts)).toBe('operational');
    expect(classifyCheck({ ...ok, httpStatus: 301 }, opts)).toBe('operational');
    expect(classifyCheck({ ...ok, latencyMs: 2000 }, opts)).toBe('operational');
  });

  it('is degraded when slower than the threshold', () => {
    expect(classifyCheck({ ...ok, latencyMs: 2001 }, opts)).toBe('degraded');
    expect(classifyCheck({ ...ok, latencyMs: 900 }, { degradedMs: 500 })).toBe('degraded');
  });

  it('is down on timeouts, connection errors, 5xx and unexpected 4xx', () => {
    expect(classifyCheck({ ...ok, httpStatus: null, latencyMs: null, timedOut: true, error: 'timeout after 10000 ms' }, opts)).toBe('down');
    expect(classifyCheck({ ...ok, httpStatus: null, error: 'ECONNREFUSED' }, opts)).toBe('down');
    expect(classifyCheck({ ...ok, httpStatus: 503 }, opts)).toBe('down');
    expect(classifyCheck({ ...ok, httpStatus: 404 }, opts)).toBe('down');
    expect(classifyCheck({ ...ok, httpStatus: 401 }, { ...opts, okStatuses: [401] })).toBe('operational');
  });

  it('describes failures and durations', () => {
    expect(failureReason({ httpStatus: 503, error: null })).toBe('HTTP 503');
    expect(failureReason({ httpStatus: null, error: 'ECONNRESET' })).toBe('ECONNRESET');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
  });
});

describe('incidents', () => {
  it('open on the transition to down and resolve on recovery', () => {
    expect(incidentAction('down', false)).toBe('open');
    expect(incidentAction('down', true)).toBe('extend');
    expect(incidentAction('operational', true)).toBe('resolve');
    expect(incidentAction('degraded', true)).toBe('resolve');
    expect(incidentAction('degraded', false)).toBe('none');
  });

  it('builds status events for the existing event pipeline', () => {
    const target = { id: 'knu-site', name: 'knu.ua', url: 'https://knu.ua/' };
    const at = new Date('2026-09-24T12:00:00Z');
    expect(statusDownEvent(target, 'home', 'HTTP 502', at)).toMatchObject({
      kind: 'status.down',
      severity: 'error',
      title: 'knu.ua is down: HTTP 502',
      data: { target: 'knu-site', vantage: 'home' },
    });
    expect(statusUpEvent(target, 'home', 300, at).title).toBe('knu.ua recovered after 5 min');
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('httpCheck against local servers', () => {
  let plain: http.Server;
  let base: string;

  beforeAll(async () => {
    plain = http.createServer((req, res) => {
      if (req.url === '/ok') res.writeHead(200).end('hello');
      else if (req.url === '/redirect') res.writeHead(302, { location: '/ok' }).end();
      else if (req.url === '/loop') res.writeHead(302, { location: '/loop' }).end();
      else if (req.url === '/error') res.writeHead(503).end('down');
      else if (req.url === '/slow') setTimeout(() => res.writeHead(200).end('late'), 1_500);
      else if (req.url === '/big') res.writeHead(200).end(Buffer.alloc(2 * 1024 * 1024, 97));
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
  });

  afterAll(() => plain?.close());

  it('reports status and latency, following redirects', async () => {
    const r = await httpCheck(`${base}/redirect`, { timeoutMs: 5_000 });
    expect(r).toMatchObject({ httpStatus: 200, error: null, timedOut: false, tlsOk: null, redirects: 1, finalUrl: `${base}/ok` });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('stops following redirect loops', async () => {
    expect(await httpCheck(`${base}/loop`, { timeoutMs: 5_000, maxRedirects: 3 })).toMatchObject({ httpStatus: 302, redirects: 3 });
  });

  it('reports HTTP errors without throwing', async () => {
    expect((await httpCheck(`${base}/error`, { timeoutMs: 5_000 })).httpStatus).toBe(503);
  });

  it('times out on one deadline', async () => {
    const r = await httpCheck(`${base}/slow`, { timeoutMs: 300 });
    expect(r).toMatchObject({ timedOut: true, httpStatus: null, error: 'timeout after 300 ms' });
  });

  it('does not download huge bodies', async () => {
    const r = await httpCheck(`${base}/big`, { timeoutMs: 5_000, maxBodyBytes: 64 * 1024 });
    expect(r).toMatchObject({ httpStatus: 200, error: null });
  });

  it('reports refused connections', async () => {
    const r = await httpCheck('http://127.0.0.1:1/', { timeoutMs: 1_000 });
    expect(r.httpStatus).toBeNull();
    expect(r.error ?? '').toMatch(/ECONNREFUSED|timeout/);
  });

  describe.skipIf(!hasOpenssl())('over TLS with an untrusted certificate', () => {
    let dir: string;
    let server: https.Server;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'labwatch-status-'));
      execFileSync(
        'openssl',
        ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
          '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=test.local'],
        { stdio: 'ignore' },
      );
      server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (_req, res) =>
        res.writeHead(200).end('ok'),
      );
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    });

    afterAll(() => {
      server?.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('records the TLS problem but still reports the site as answering', async () => {
      const r = await httpCheck(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`, { timeoutMs: 5_000 });
      expect(r.httpStatus).toBe(200);
      expect(r.tlsOk).toBe(false);
      expect(r.tlsError).toMatch(/SELF_SIGNED|self-signed/i);
      expect(classifyCheck(r, { degradedMs: 2000 })).toBe('operational');
    });
  });
});
