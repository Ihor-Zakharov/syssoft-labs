import type { CiState } from './ci.js';

export interface BranchTabInfo {
  name: string;
  isDefault: boolean;
  /** Newest of: head commit date, latest CI run update, PR update. */
  lastActivityAt: string | null;
  merged: boolean;
  ciState: CiState;
}

export const IDLE_DAYS = 14;

export interface ArrangedTabs<T extends BranchTabInfo> {
  /** Default branch first, then the active branches by latest activity. */
  visible: T[];
  /** Merged branches and branches idle for more than IDLE_DAYS, most recent first. */
  overflow: T[];
}

function activityMs(branch: BranchTabInfo): number {
  return branch.lastActivityAt ? new Date(branch.lastActivityAt).getTime() : 0;
}

function byActivity(a: BranchTabInfo, b: BranchTabInfo): number {
  return activityMs(b) - activityMs(a) || a.name.localeCompare(b.name);
}

export function arrangeBranchTabs<T extends BranchTabInfo>(branches: readonly T[], now: Date, idleDays = IDLE_DAYS): ArrangedTabs<T> {
  const idleBefore = now.getTime() - idleDays * 24 * 60 * 60 * 1000;
  const defaults = branches.filter((b) => b.isDefault);
  const visible: T[] = [];
  const overflow: T[] = [];
  for (const branch of branches) {
    if (branch.isDefault) continue;
    const idle = activityMs(branch) < idleBefore;
    (branch.merged || idle ? overflow : visible).push(branch);
  }
  return { visible: [...defaults, ...visible.sort(byActivity)], overflow: overflow.sort(byActivity) };
}
