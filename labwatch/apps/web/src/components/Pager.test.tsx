import type { Paged } from '@labwatch/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewerNotice, Pager } from './Pager';

const paged = (total: number, page: number, newer = 0): Paged<unknown> => ({
  rows: [],
  total,
  page,
  pageSize: 15,
  anchor: { at: '2026-09-24T10:00:00.000Z', key: '1' },
  newer,
});
const noop = () => {};

describe('Pager', () => {
  it('is hidden when everything fits on one page', () => {
    expect(renderToStaticMarkup(<Pager paged={paged(15, 1)} onPage={noop} label="CI runs" />)).toBe('');
    expect(renderToStaticMarkup(<Pager paged={undefined} onPage={noop} label="CI runs" />)).toBe('');
  });

  it('shows the range, the current page and disables the ends', () => {
    const html = renderToStaticMarkup(<Pager paged={paged(87, 2)} onPage={noop} label="CI runs" />);
    expect(html).toContain('aria-label="CI runs: pages"');
    expect(html).toContain('Showing 16–30 of 87');
    expect(html).toMatch(/aria-current="page"[^>]*>2</);
    expect(html).not.toContain('disabled=""><');

    const last = renderToStaticMarkup(<Pager paged={paged(87, 6)} onPage={noop} label="CI runs" />);
    expect(last).toContain('Showing 76–87 of 87');
    expect(last).toMatch(/disabled=""[^>]*aria-label="Next page"/);
  });

  it('collapses long page lists with gaps', () => {
    const html = renderToStaticMarkup(<Pager paged={paged(15 * 30, 15)} onPage={noop} label="Commits" />);
    expect(html.match(/aria-label="Page \d+"/g)).toEqual(['aria-label="Page 1"', 'aria-label="Page 14"', 'aria-label="Page 15"', 'aria-label="Page 16"', 'aria-label="Page 30"']);
    expect(html.match(/…/g)).toHaveLength(2);
  });
});

describe('NewerNotice', () => {
  it('offers the way back only on later pages with new rows', () => {
    expect(renderToStaticMarkup(<NewerNotice paged={paged(40, 1, 3)} onLatest={noop} noun="run" />)).toBe('');
    expect(renderToStaticMarkup(<NewerNotice paged={paged(40, 2, 0)} onLatest={noop} noun="run" />)).toBe('');
    expect(renderToStaticMarkup(<NewerNotice paged={paged(40, 2, 3)} onLatest={noop} noun="run" />)).toContain('3 new runs — back to latest');
    expect(renderToStaticMarkup(<NewerNotice paged={paged(40, 2, 1)} onLatest={noop} noun="run" />)).toContain('1 new run — back to latest');
  });
});
