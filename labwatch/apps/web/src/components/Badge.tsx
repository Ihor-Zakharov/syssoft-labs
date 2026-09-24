import type { CiState, Level, ReviewRunOutcome, ReviewState, StatusLevel, TestTotals } from '@labwatch/shared';
import type { ReactNode } from 'react';

export type Tone = 'ok' | 'bad' | 'warn' | 'partial' | 'run' | 'muted';

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse = false, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  return <span className={`dot dot-${tone}${pulse ? ' pulse' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export function levelTone(level: Level): Tone {
  return ({ ok: 'ok', warn: 'warn', partial: 'partial', bad: 'bad', none: 'muted' } as const)[level];
}

/** Tab dots: green success, red failure, yellow running, grey none. */
export function ciTone(state: CiState): Tone {
  return ({ success: 'ok', failure: 'bad', running: 'warn', none: 'muted' } as const)[state];
}

export const CI_STATE_LABEL: Record<CiState, string> = {
  success: 'CI passed',
  failure: 'CI failed',
  running: 'CI running',
  none: 'no CI run',
};

export function statusTone(level: StatusLevel): Tone {
  return ({ operational: 'ok', degraded: 'warn', partial_outage: 'partial', major_outage: 'bad', no_data: 'muted' } as const)[level];
}

/** GitHub run status + conclusion → one badge. */
export function runTone(status: string, conclusion: string | null): Tone {
  if (status !== 'completed') return status === 'in_progress' ? 'run' : 'muted';
  switch (conclusion) {
    case 'success':
      return 'ok';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'bad';
    case 'action_required':
      return 'warn';
    default:
      return 'muted';
  }
}

export function runLabel(status: string, conclusion: string | null): string {
  if (status !== 'completed') return status.replace('_', ' ');
  return conclusion?.replace('_', ' ') ?? 'completed';
}

export function TestsBadge({ tests }: { tests: TestTotals | null }) {
  if (!tests) return null;
  return tests.failed > 0 ? (
    <Badge tone="bad" title={`${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped`}>
      {tests.failed} failed
    </Badge>
  ) : (
    <Badge tone="ok" title={`${tests.skipped} skipped`}>
      {tests.passed}/{tests.total} passed
    </Badge>
  );
}

export function ReviewBadge({ outcome }: { outcome: ReviewRunOutcome | null }) {
  if (!outcome) return null;
  switch (outcome.kind) {
    case 'running':
      return <Badge tone="run">reviewing…</Badge>;
    case 'failed':
      return <Badge tone="bad">review failed</Badge>;
    case 'no_comments':
      return (
        <Badge tone="muted" title="The review run finished without posting anything">
          review ran, no comments
        </Badge>
      );
    case 'posted':
      return outcome.findings > 0 ? (
        <Badge tone="warn">
          {outcome.findings} finding{outcome.findings === 1 ? '' : 's'}
        </Badge>
      ) : (
        <Badge tone="ok">reviewed, no findings</Badge>
      );
  }
}

const REVIEW_STATE: Record<ReviewState, { tone: Tone; label: string }> = {
  approved: { tone: 'ok', label: 'approved' },
  changes_requested: { tone: 'bad', label: 'changes requested' },
  commented: { tone: 'run', label: 'commented' },
  none: { tone: 'muted', label: 'no review' },
};

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  const { tone, label } = REVIEW_STATE[state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function AreaBadges({ areas }: { areas: string[] | null }) {
  if (areas === null) return <span className="muted small" title="Changed files not fetched yet">files pending</span>;
  return (
    <span className="areas">
      {areas.map((a) => (
        <span key={a} className={`area area-${a.startsWith('Lab') ? 'lab' : a.toLowerCase()}`}>
          {a}
        </span>
      ))}
    </span>
  );
}
