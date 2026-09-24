import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';

export interface HttpCheckResult {
  httpStatus: number | null;
  /** Until the end of the (capped) response body, including redirects. */
  latencyMs: number | null;
  /** null for plain http; false if any hop failed standard certificate validation. */
  tlsOk: boolean | null;
  tlsError: string | null;
  error: string | null;
  timedOut: boolean;
  finalUrl: string;
  redirects: number;
}

export interface HttpCheckOptions {
  timeoutMs: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  userAgent?: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * One availability check. TLS validation is recorded but not enforced: a site with a broken
 * certificate chain is still "up" for its users who click through, and that is what we measure.
 * The whole check (all redirects, body) has one deadline.
 */
export function httpCheck(url: string, options: HttpCheckOptions): Promise<HttpCheckResult> {
  const started = performance.now();
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBodyBytes = options.maxBodyBytes ?? 512 * 1024;
  let tlsOk: boolean | null = null;
  let tlsError: string | null = null;
  let current: http.ClientRequest | undefined;
  let timedOut = false;

  const result = (partial: Partial<HttpCheckResult> & { finalUrl: string; redirects: number }): HttpCheckResult => ({
    httpStatus: null,
    latencyMs: null,
    tlsOk,
    tlsError,
    error: null,
    timedOut,
    ...partial,
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: HttpCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(r);
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      current?.destroy(new Error(`timeout after ${options.timeoutMs} ms`));
    }, options.timeoutMs);

    const hop = (target: string, redirects: number) => {
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        finish(result({ error: `invalid URL: ${target}`, finalUrl: target, redirects }));
        return;
      }
      const secure = parsed.protocol === 'https:';
      const client = secure ? https : http;
      const request = client.get(
        parsed,
        {
          agent: false, // a fresh connection: measures connect + TLS every time
          headers: { 'User-Agent': options.userAgent ?? 'labwatch-status', Accept: 'text/html,*/*' },
          ...(secure ? { rejectUnauthorized: false } : {}),
        },
        (response) => {
          if (secure) {
            const socket = response.socket as TLSSocket;
            if (!socket.authorized) {
              tlsOk = false;
              tlsError ??= String(socket.authorizationError ?? 'certificate not trusted');
            } else if (tlsOk === null) {
              tlsOk = true;
            }
          }
          const status = response.statusCode ?? null;
          const location = response.headers.location;
          if (status !== null && REDIRECTS.has(status) && location && redirects < maxRedirects) {
            response.resume();
            hop(new URL(location, parsed).toString(), redirects + 1);
            return;
          }
          let bytes = 0;
          const done = () =>
            finish(result({ httpStatus: status, latencyMs: Math.round(performance.now() - started), finalUrl: target, redirects }));
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes >= maxBodyBytes) {
              // Enough to know the page is served; do not download huge pages every minute
              response.destroy();
              done();
            }
          });
          response.on('end', done);
          response.on('error', (e) => finish(result({ httpStatus: status, error: e.message, finalUrl: target, redirects })));
        },
      );
      current = request;
      request.on('error', (e) => finish(result({ error: e.message, finalUrl: target, redirects })));
    };

    hop(url, 0);
  });
}
