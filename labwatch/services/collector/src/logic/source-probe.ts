import { createHash } from 'node:crypto';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { SourceProbe } from '@labwatch/shared';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Downloads the source once and records what the TLS layer saw. Standard validation is switched off
 * on purpose (the certificate is expired and issued for another host name): the result carries the
 * certificate fingerprint and the validation error, and evaluateProbe() decides by pinning instead.
 * Nothing secret is sent, so accepting the connection before the pin check is safe here.
 */
export function probeSource(url: string, timeoutMs = 20_000): Promise<Omit<SourceProbe, 'ok'>> {
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  const empty = {
    url,
    checkedAt,
    httpStatus: null,
    latencyMs: null,
    bodySha256: null,
    bodyBytes: null,
    certSha256: null,
    certSubject: null,
    certValidTo: null,
    tlsError: null,
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (probe: Omit<SourceProbe, 'ok'>) => {
      if (settled) return;
      settled = true;
      resolve(probe);
    };

    const request = https.get(
      url,
      {
        rejectUnauthorized: false,
        // A fresh connection every time: a reused socket would hide a certificate change
        agent: false,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'labwatch-collector' },
      },
      (response) => {
        const socket = response.socket as TLSSocket;
        const certificate = socket.getPeerCertificate();
        const hasCert = certificate && Object.keys(certificate).length > 0;
        const tlsError = socket.authorized ? null : String(socket.authorizationError ?? 'unauthorized');
        const hash = createHash('sha256');
        let bytes = 0;

        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BODY_BYTES) {
            request.destroy(new Error(`body larger than ${MAX_BODY_BYTES} bytes`));
            return;
          }
          hash.update(chunk);
        });
        response.on('end', () =>
          finish({
            ...empty,
            httpStatus: response.statusCode ?? null,
            latencyMs: Math.round(performance.now() - started),
            bodySha256: hash.digest('hex'),
            bodyBytes: bytes,
            certSha256: hasCert ? certificate.fingerprint256 : null,
            certSubject: hasCert ? (certificate.subject?.CN?.toString() ?? null) : null,
            certValidTo: hasCert && certificate.valid_to ? new Date(certificate.valid_to).toISOString() : null,
            tlsError,
            error: null,
          }),
        );
        response.on('error', (error) => finish({ ...empty, tlsError, error: error.message }));
      },
    );

    request.on('timeout', () => request.destroy(new Error(`no response in ${timeoutMs} ms`)));
    request.on('error', (error) => finish({ ...empty, error: error.message }));
  });
}
