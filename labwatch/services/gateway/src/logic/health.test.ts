import { describe, expect, it } from 'vitest';
import { diffHealth, serviceHealth } from './health.js';

const now = new Date('2026-09-24T12:00:00Z');

describe('serviceHealth', () => {
  it('is up with a heartbeat and down without one', () => {
    const up = serviceHealth('collector', {
      service: 'collector',
      at: '2026-09-24T11:59:50Z',
      pid: 7,
      version: '0.1.0',
      startedAt: '2026-09-24T11:00:00Z',
    });
    expect(up).toMatchObject({ up: true, lastSeen: '2026-09-24T11:59:50Z', version: '0.1.0' });
    expect(serviceHealth('collector', null)).toMatchObject({ up: false, lastSeen: null });
  });
});

describe('diffHealth', () => {
  it('seeds silently', () => {
    expect(diffHealth(null, { collector: false }, now).events).toEqual([]);
  });

  it('reports down and up transitions only', () => {
    const down = diffHealth({ collector: true, postgres: true }, { collector: false, postgres: true }, now);
    expect(down.events).toMatchObject([{ kind: 'service.down', severity: 'error', data: { service: 'collector' } }]);
    expect(diffHealth(down.next, { collector: false, postgres: true }, now).events).toEqual([]);
    expect(diffHealth(down.next, { collector: true, postgres: true }, now).events.map((e) => e.kind)).toEqual(['service.up']);
  });

  it('does not report services it had not seen before', () => {
    expect(diffHealth({ collector: true }, { collector: true, postgres: false }, now).events).toEqual([]);
  });
});
