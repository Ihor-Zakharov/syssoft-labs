import { describe, expect, it } from 'vitest';
import { runLabel, runTone } from './components/Badge';
import { duration, firstLine, shortSha, timeAgo } from './format';

const now = new Date('2026-09-24T12:00:00Z').getTime();

describe('format', () => {
  it('prints relative times', () => {
    expect(timeAgo(null, now)).toBe('—');
    expect(timeAgo('2026-09-24T11:59:58Z', now)).toBe('just now');
    expect(timeAgo('2026-09-24T11:59:30Z', now)).toBe('30s ago');
    expect(timeAgo('2026-09-24T11:45:00Z', now)).toBe('15m ago');
    expect(timeAgo('2026-09-24T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-09-20T12:00:00Z', now)).toBe('4d ago');
    expect(timeAgo('2026-09-24T12:00:10Z', now)).toBe('just now');
  });

  it('prints durations', () => {
    expect(duration('2026-09-24T11:58:55Z', now)).toBe('1m 05s');
    expect(duration('2026-09-24T11:59:50Z', now)).toBe('10s');
    expect(duration(null, now)).toBe('—');
  });

  it('shortens shas and commit messages', () => {
    expect(shortSha('8e82e62abcdef')).toBe('8e82e62');
    expect(firstLine('Title\n\nbody')).toBe('Title');
  });
});

describe('run badges', () => {
  it('maps status and conclusion to a tone and label', () => {
    expect(runTone('in_progress', null)).toBe('run');
    expect(runTone('queued', null)).toBe('muted');
    expect(runTone('completed', 'success')).toBe('ok');
    expect(runTone('completed', 'failure')).toBe('bad');
    expect(runTone('completed', 'cancelled')).toBe('muted');
    expect(runLabel('in_progress', null)).toBe('in progress');
    expect(runLabel('completed', 'timed_out')).toBe('timed out');
  });
});
