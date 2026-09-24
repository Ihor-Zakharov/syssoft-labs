import type { LabEvent, SourceProbe, SourceStatus } from '@labwatch/shared';

/** "7f:96:a6..." / "7F96A6..." → "7F96A6...": the same fingerprint regardless of formatting. */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

export function fingerprintsEqual(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && normalizeFingerprint(a) === normalizeFingerprint(b);
}

export interface SourceExpectations {
  certSha256: string;
  bodySha256: string | null;
}

/**
 * The certificate of this server is expired and issued for another name, so "is TLS valid" is always
 * false. What matters is whether it is the SAME certificate we pinned: then the source is OK.
 */
export function evaluateProbe(probe: Omit<SourceProbe, 'ok'>, expected: SourceExpectations): SourceStatus {
  const certPinned = fingerprintsEqual(probe.certSha256, expected.certSha256);
  const bodyMatches =
    expected.bodySha256 === null || probe.bodySha256 === null
      ? null
      : probe.bodySha256.toLowerCase() === expected.bodySha256.toLowerCase();
  return {
    ...probe,
    ok: probe.error === null && probe.httpStatus === 200 && certPinned,
    expectedCertSha256: normalizeFingerprint(expected.certSha256),
    expectedBodySha256: expected.bodySha256,
    certPinned,
    bodyMatches,
  };
}

export interface SourceState {
  ok: boolean;
  bodySha256: string | null;
  certSha256: string | null;
}

export function toSourceState(status: SourceStatus): SourceState {
  return { ok: status.ok, bodySha256: status.bodySha256, certSha256: status.certSha256 };
}

/**
 * Events on transitions only: up↔down, and a changed body or certificate. A failed probe has no
 * hash or fingerprint, and that is not a "change": the last known values are kept for comparison.
 */
export function diffSource(prev: SourceState | null, status: SourceStatus, now: Date): { next: SourceState; events: LabEvent[] } {
  const next: SourceState = {
    ok: status.ok,
    bodySha256: status.bodySha256 ?? prev?.bodySha256 ?? null,
    certSha256: status.certSha256 ?? prev?.certSha256 ?? null,
  };
  if (prev === null) return { next, events: [] };

  const at = now.toISOString();
  const base = { url: status.url, httpStatus: status.httpStatus, error: status.error };
  const events: LabEvent[] = [];

  if (prev.ok && !status.ok) {
    const reason = status.error ?? (status.certPinned ? `HTTP ${status.httpStatus}` : 'certificate is not the pinned one');
    events.push({ kind: 'source.down', severity: 'error', title: `manual.txt source is down: ${reason}`, at, data: base });
  } else if (!prev.ok && status.ok) {
    events.push({ kind: 'source.up', severity: 'info', title: 'manual.txt source is back up', at, data: base });
  }

  if (status.bodySha256 && prev.bodySha256 && status.bodySha256 !== prev.bodySha256) {
    events.push({
      kind: 'source.body_changed',
      severity: 'warning',
      title: 'manual.txt content changed',
      at,
      data: { ...base, previous: prev.bodySha256, current: status.bodySha256 },
    });
  }

  if (status.certSha256 && prev.certSha256 && !fingerprintsEqual(status.certSha256, prev.certSha256)) {
    events.push({
      kind: 'source.cert_changed',
      severity: 'warning',
      title: 'Source server certificate changed',
      at,
      data: {
        ...base,
        previous: normalizeFingerprint(prev.certSha256),
        current: normalizeFingerprint(status.certSha256),
        pinned: status.certPinned,
      },
    });
  }

  return { next, events };
}
