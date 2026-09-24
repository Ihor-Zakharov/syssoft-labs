import { pageMath, pagerItems, type PageAnchor, type Paged } from '@labwatch/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * Anchored paging on the client: while the reader is on page 1 the newest row's anchor is remembered;
 * pages 2…N are requested with it, so rows arriving meanwhile do not shift them. `resetKey` (branch,
 * filter) starts over. The query passes `anchor`; the section calls `useRememberAnchor` with the result.
 */
export function usePageAnchor(page: number, resetKey: string): { anchor: PageAnchor | null; remember: (anchor: PageAnchor | null | undefined) => void } {
  const [state, setState] = useState<{ key: string; anchor: PageAnchor | null }>({ key: resetKey, anchor: null });
  const current = state.key === resetKey ? state.anchor : null;

  const remember = useCallback(
    (anchor: PageAnchor | null | undefined) => {
      if (!anchor) return;
      setState((prev) => {
        const known = prev.key === resetKey ? prev.anchor : null;
        // Page 1 follows the newest row; other pages keep the anchor they started from
        if (page > 1 && known) return prev;
        if (known && known.key === anchor.key && known.at === anchor.at) return prev;
        return { key: resetKey, anchor };
      });
    },
    [page, resetKey],
  );

  return { anchor: page > 1 ? current : null, remember };
}

/**
 * Remembers the anchor a page came back with, and follows the server when it clamped the page.
 * Pass the query's data only when it is real (not keepPreviousData's placeholder of the previous page).
 */
export function useRememberAnchor(paged: Paged<unknown> | undefined, page: number, remember: (anchor: PageAnchor | null | undefined) => void, onPage: (page: number) => void) {
  // Keyed on the anchor's fields: a refetch with the same anchor must not re-run it
  useEffect(() => remember(paged?.anchor), [paged?.anchor?.key, paged?.anchor?.at, remember]);
  useEffect(() => {
    if (paged && paged.page !== page) onPage(paged.page);
  }, [paged?.page, page]);
}

/** `‹ Prev  1 2 3 … N  Next ›  Showing 16–30 of 87`; nothing when everything fits on one page. */
export function Pager({ paged, onPage, label }: { paged: Paged<unknown> | undefined; onPage: (page: number) => void; label: string }) {
  if (!paged || paged.total <= paged.pageSize) return null;
  const { pages, page, from, to } = pageMath(paged.total, paged.page, paged.pageSize);
  return (
    <nav className="pager" aria-label={`${label}: pages`}>
      <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹ Prev
      </button>
      {pagerItems(page, pages).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="pager-gap" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`pager-btn${item === page ? ' pager-on' : ''}`}
            aria-current={item === page ? 'page' : undefined}
            aria-label={`Page ${item}`}
            onClick={() => onPage(item)}
          >
            {item}
          </button>
        ),
      )}
      <button type="button" className="pager-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next ›
      </button>
      <span className="muted small pager-range">
        Showing {from}–{to} of {paged.total}
      </span>
    </nav>
  );
}

/** On pages 2…N: "3 new — back to latest" instead of jumping when new rows arrive. */
export function NewerNotice({ paged, onLatest, noun }: { paged: Paged<unknown> | undefined; onLatest: () => void; noun: string }) {
  if (!paged || paged.page <= 1 || paged.newer === 0) return null;
  return (
    <p className="newer-notice small">
      <button type="button" className="link-button" onClick={onLatest}>
        {paged.newer} new {paged.newer === 1 ? noun : `${noun}s`} — back to latest
      </button>
    </p>
  );
}
