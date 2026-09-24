export type Tone = 'ok' | 'bad' | 'warn' | 'run' | 'muted';

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return <span className={`dot dot-${tone}${pulse ? ' pulse' : ''}`} aria-hidden />;
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
