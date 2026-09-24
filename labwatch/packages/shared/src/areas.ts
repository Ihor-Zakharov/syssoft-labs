/**
 * Which part of the repository a changed file belongs to. Attribution is by FILE PATH (commit
 * messages are unreliable): Lab<N>/ → "Lab N", labwatch/ → "Infra", .github/ → "CI", else "Repo".
 */
export function areaForPath(path: string): string {
  const lab = /^Lab(\d+)\//.exec(path);
  if (lab) return `Lab ${Number(lab[1])}`;
  if (path.startsWith('labwatch/')) return 'Infra';
  if (path.startsWith('.github/')) return 'CI';
  return 'Repo';
}

const FIXED_ORDER = ['Infra', 'CI', 'Repo'];

/** Labs by number first, then Infra, CI, Repo. */
export function compareAreas(a: string, b: string): number {
  const la = labNumber(a);
  const lb = labNumber(b);
  if (la !== null && lb !== null) return la - lb;
  if (la !== null) return -1;
  if (lb !== null) return 1;
  return FIXED_ORDER.indexOf(a) - FIXED_ORDER.indexOf(b);
}

/** Distinct areas of a set of paths, in display order. A commit may touch several areas. */
export function areasForPaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map(areaForPath))].sort(compareAreas);
}

/** "Lab 3" → 3, anything else → null. */
export function labNumber(area: string): number | null {
  const match = /^Lab (\d+)$/.exec(area);
  return match ? Number(match[1]) : null;
}

/** Top-level directory name "Lab3" → 3 (lab discovery from the default branch tree). */
export function labNumberFromDir(name: string): number | null {
  const match = /^Lab(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

export function labArea(n: number): string {
  return `Lab ${n}`;
}
