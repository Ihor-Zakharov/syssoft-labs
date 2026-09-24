import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const render = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe('Markdown (untrusted review comments)', () => {
  it('renders ordinary Markdown with GitHub extensions', () => {
    const html = render('**Bug**: `Directory.CreateDirectory` throws\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done');
    expect(html).toContain('<strong>Bug</strong>');
    expect(html).toContain('<code>Directory.CreateDirectory</code>');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
  });

  it('drops raw HTML', () => {
    const html = render('Hello <script>alert(1)</script> <img src=x onerror="alert(1)"> <iframe src="https://evil.test"></iframe>');
    expect(html).not.toMatch(/<script|onerror|<iframe|<img/i);
    expect(html).toContain('Hello');
  });

  it('removes dangerous link targets', () => {
    const html = render('[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [ok](https://github.com/o/r/pull/1#r1)');
    expect(html).not.toMatch(/javascript:|data:text/i);
    expect(html).toContain('href="https://github.com/o/r/pull/1#r1"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('shows images as links instead of loading them', () => {
    const html = render('![diagram](https://tracker.test/pixel.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://tracker.test/pixel.png"');
  });

  it('escapes text that looks like HTML inside code', () => {
    expect(render('`<b>not bold</b>`')).toContain('&lt;b&gt;not bold&lt;/b&gt;');
  });
});
