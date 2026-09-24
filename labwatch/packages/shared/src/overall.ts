import type { CiState } from './ci.js';
import type { StatusLevel } from './status.js';

/** Colour of a dot: green / yellow / orange / red / grey. */
export type Level = 'ok' | 'warn' | 'partial' | 'bad' | 'none';

const SEVERITY: Record<Level, number> = { none: 0, ok: 1, warn: 2, partial: 3, bad: 4 };

export function worstLevel(levels: readonly Level[]): Level {
  return levels.reduce<Level>((worst, level) => (SEVERITY[level] > SEVERITY[worst] ? level : worst), 'none');
}

export function ciLevel(state: CiState): Level {
  return { success: 'ok', failure: 'bad', running: 'warn', none: 'none' }[state] as Level;
}

export function statusPageLevel(level: StatusLevel): Level {
  return { operational: 'ok', degraded: 'warn', partial_outage: 'partial', major_outage: 'bad', no_data: 'none' }[level] as Level;
}

export interface OverallInput {
  services: ReadonlyArray<{ name: string; up: boolean }>;
  /** manual.txt source: null = not probed yet. */
  sourceOk: boolean | null;
  mainCi: CiState;
  statusLevel: StatusLevel;
}

export interface Overall {
  level: Level;
  issues: string[];
}

/** Worst of: CI on the default branch, the status page, the services and the lab source. */
export function overallStatus(input: OverallInput): Overall {
  const issues: string[] = [];
  const levels: Level[] = [ciLevel(input.mainCi), statusPageLevel(input.statusLevel)];

  if (input.mainCi === 'failure') issues.push('CI is failing on the default branch');
  if (input.statusLevel === 'major_outage') issues.push('Major outage on the status page');
  if (input.statusLevel === 'partial_outage') issues.push('Partial outage on the status page');
  if (input.statusLevel === 'degraded') issues.push('Degraded performance on the status page');

  const down = input.services.filter((s) => !s.up).map((s) => s.name);
  if (input.services.length > 0) levels.push(down.length > 0 ? 'bad' : 'ok');
  if (down.length > 0) issues.push(`${down.join(', ')} ${down.length === 1 ? 'is' : 'are'} down`);

  if (input.sourceOk !== null) levels.push(input.sourceOk ? 'ok' : 'bad');
  if (input.sourceOk === false) issues.push('manual.txt source is down');

  return { level: worstLevel(levels), issues };
}
