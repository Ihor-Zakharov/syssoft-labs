import type { SourceProbe } from '@labwatch/shared';
import { describe, expect, it } from 'vitest';
import { diffSource, evaluateProbe, fingerprintsEqual, normalizeFingerprint, toSourceState } from './source.js';

const now = new Date('2026-09-24T12:00:00Z');
const PIN = '7F96A64D03536BC384D4CF118B4BB52DB1E906372FE73B81BF771BF90226B378';
const PIN_COLONS = PIN.match(/../g)!.join(':');
const BODY = '02a592dd5411b84b036606dc98048ff224dec95f3ac27d8399a9d52f699c21ca';
const expected = { certSha256: PIN, bodySha256: BODY };

function probe(overrides: Partial<Omit<SourceProbe, 'ok'>> = {}): Omit<SourceProbe, 'ok'> {
  return {
    url: 'https://91.202.128.107/manual.txt',
    checkedAt: now.toISOString(),
    httpStatus: 200,
    latencyMs: 120,
    bodySha256: BODY,
    bodyBytes: 3663,
    certSha256: PIN_COLONS,
    certSubject: 'mail.univ.net.ua',
    certValidTo: '2026-08-20T13:23:51.000Z',
    tlsError: 'CERT_HAS_EXPIRED',
    error: null,
    ...overrides,
  };
}

describe('fingerprints', () => {
  it('compare regardless of colons and case', () => {
    expect(normalizeFingerprint(PIN_COLONS.toLowerCase())).toBe(PIN);
    expect(fingerprintsEqual(PIN_COLONS, PIN.toLowerCase())).toBe(true);
    expect(fingerprintsEqual(PIN, null)).toBe(false);
    expect(fingerprintsEqual(PIN, 'AA' + PIN.slice(2))).toBe(false);
  });
});

describe('evaluateProbe', () => {
  it('is OK with an expired but pinned certificate', () => {
    const status = evaluateProbe(probe(), expected);
    expect(status).toMatchObject({ ok: true, certPinned: true, bodyMatches: true, expectedCertSha256: PIN });
  });

  it('is not OK with another certificate even if HTTP succeeded', () => {
    const status = evaluateProbe(probe({ certSha256: 'AB'.repeat(32) }), expected);
    expect(status).toMatchObject({ ok: false, certPinned: false });
  });

  it('is not OK on HTTP errors or network errors', () => {
    expect(evaluateProbe(probe({ httpStatus: 404 }), expected).ok).toBe(false);
    expect(evaluateProbe(probe({ httpStatus: null, certSha256: null, bodySha256: null, error: 'ECONNREFUSED' }), expected).ok).toBe(false);
  });

  it('reports a body mismatch but still counts the source as up', () => {
    const status = evaluateProbe(probe({ bodySha256: 'ff'.repeat(32) }), expected);
    expect(status).toMatchObject({ ok: true, bodyMatches: false });
  });

  it('skips the body check when no hash is expected', () => {
    expect(evaluateProbe(probe(), { certSha256: PIN, bodySha256: null }).bodyMatches).toBeNull();
  });
});

describe('diffSource', () => {
  const up = evaluateProbe(probe(), expected);
  const down = evaluateProbe(probe({ httpStatus: null, bodySha256: null, certSha256: null, error: 'timeout' }), expected);

  it('seeds silently', () => {
    expect(diffSource(null, down, now).events).toEqual([]);
  });

  it('reports down and up transitions only', () => {
    const wentDown = diffSource(toSourceState(up), down, now);
    expect(wentDown.events.map((e) => e.kind)).toEqual(['source.down']);
    expect(wentDown.events[0]!.title).toContain('timeout');
    expect(diffSource(wentDown.next, down, now).events).toEqual([]);
    expect(diffSource(wentDown.next, up, now).events.map((e) => e.kind)).toEqual(['source.up']);
  });

  it('keeps the last known hashes through an outage', () => {
    const { next } = diffSource(toSourceState(up), down, now);
    expect(next).toEqual({ ok: false, bodySha256: BODY, certSha256: PIN_COLONS });
  });

  it('reports changed content and a changed certificate', () => {
    const changed = evaluateProbe(probe({ bodySha256: 'ff'.repeat(32), certSha256: 'AB'.repeat(32) }), expected);
    const kinds = diffSource(toSourceState(up), changed, now).events.map((e) => e.kind);
    expect(kinds).toEqual(['source.down', 'source.body_changed', 'source.cert_changed']);
  });

  it('does not treat a reformatted fingerprint as a change', () => {
    const sameCert = evaluateProbe(probe({ certSha256: PIN }), expected);
    expect(diffSource(toSourceState(up), sameCert, now).events).toEqual([]);
  });
});
