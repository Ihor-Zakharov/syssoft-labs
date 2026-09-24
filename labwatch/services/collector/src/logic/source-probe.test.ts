import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeSource } from './source-probe.js';
import { fingerprintsEqual } from './source.js';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const BODY = 'Probing Test\r\nflashrom -p internal\r\n';

// A real HTTPS server with a throwaway self-signed certificate: the same situation as the lab
// source (standard validation fails), so the probe must still read the body and the fingerprint.
describe.skipIf(!hasOpenssl())('probeSource against a self-signed HTTPS server', () => {
  let dir: string;
  let server: https.Server;
  let url: string;
  let certFingerprint: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'labwatch-tls-'));
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=test.local',
    ], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'cert.pem'));
    certFingerprint = new X509Certificate(cert).fingerprint256;

    server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert }, (req, res) => {
      if (req.url === '/manual.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end(BODY);
      } else {
        res.writeHead(404).end('not found');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('records status, body hash, certificate fingerprint and the TLS validation error', async () => {
    const probe = await probeSource(`${url}/manual.txt`);

    expect(probe.error).toBeNull();
    expect(probe.httpStatus).toBe(200);
    expect(probe.bodyBytes).toBe(Buffer.byteLength(BODY));
    expect(probe.bodySha256).toBe(createHash('sha256').update(BODY).digest('hex'));
    expect(fingerprintsEqual(probe.certSha256, certFingerprint)).toBe(true);
    expect(probe.certSubject).toBe('test.local');
    expect(probe.tlsError).toMatch(/SELF_SIGNED|self-signed/i);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports HTTP errors with the status code', async () => {
    const probe = await probeSource(`${url}/missing`);
    expect(probe.httpStatus).toBe(404);
    expect(probe.error).toBeNull();
  });

  it('reports connection errors without throwing', async () => {
    // Refused or silently dropped depending on the host firewall: both must end as an error, not an exception
    const probe = await probeSource('https://127.0.0.1:1/manual.txt', 1_000);
    expect(probe.httpStatus).toBeNull();
    expect(probe.certSha256).toBeNull();
    expect(probe.error).toMatch(/ECONNREFUSED|no response in 1000 ms/);
  });
});
