// Server-side paging with a stable anchor: page N is counted from the newest row as it was when the
// reader left page 1, so rows arriving meanwhile do not shift the page they are looking at.

export const PAGE_SIZE = 15;

/** The newest row at the time the reader left page 1: its time and its key (run id, sha, …) as text. */
export interface PageAnchor {
  at: string;
  key: string;
}

export interface PageArgs {
  /** 1-based; out-of-range pages are clamped to the last page. */
  page: number;
  pageSize: number;
  /** null on page 1 (the server takes the newest row); pages 2…N send back the anchor of page 1. */
  anchor: PageAnchor | null;
}

export interface Paged<T> {
  rows: T[];
  /** Rows up to the anchor — what the pager counts. */
  total: number;
  /** The page actually returned (after clamping). */
  page: number;
  pageSize: number;
  /** The anchor the page was computed from; the client keeps it for the other pages. */
  anchor: PageAnchor | null;
  /** Rows newer than the anchor (arrived since the reader left page 1): "N new — back to latest". */
  newer: number;
}

export interface PageMath {
  pages: number;
  page: number;
  /** 1-based positions of the first and last row shown ("Showing 16–30 of 87"); 0–0 when empty. */
  from: number;
  to: number;
  offset: number;
}

export function pageMath(total: number, page: number, pageSize = PAGE_SIZE): PageMath {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const offset = (current - 1) * pageSize;
  return { pages, page: current, from: total === 0 ? 0 : offset + 1, to: Math.min(offset + pageSize, total), offset };
}

/**
 * Page buttons: always the first and last page, the current one with a neighbour on each side,
 * gaps as "…": 1 2 3 4 … 9 / 1 … 4 5 6 … 9 / 1 … 6 7 8 9. At most 7 entries, so the pager keeps its width.
 */
export function pagerItems(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, 4, 'gap', pages];
  if (page >= pages - 2) return [1, 'gap', pages - 3, pages - 2, pages - 1, pages];
  return [1, 'gap', page - 1, page, page + 1, 'gap', pages];
}

/**
 * The same anchored paging over a list that is already in memory (newest first), e.g. a branch's
 * commits from the collector's snapshot. The anchor key is the row's key (`keyOf`).
 */
export function pageList<T>(list: readonly T[], args: PageArgs, keyOf: (row: T) => string, atOf: (row: T) => string): Paged<T> {
  const anchorIndex = args.anchor ? list.findIndex((row) => keyOf(row) === args.anchor!.key) : 0;
  // The anchor row vanished (e.g. the branch was force-pushed): start from the newest again
  const start = anchorIndex < 0 ? 0 : anchorIndex;
  const upToAnchor = list.slice(start);
  const first = upToAnchor[0];
  const { page, offset } = pageMath(upToAnchor.length, args.page, args.pageSize);
  return {
    rows: upToAnchor.slice(offset, offset + args.pageSize),
    total: upToAnchor.length,
    page,
    pageSize: args.pageSize,
    anchor: first ? { at: atOf(first), key: keyOf(first) } : null,
    newer: start,
  };
}
