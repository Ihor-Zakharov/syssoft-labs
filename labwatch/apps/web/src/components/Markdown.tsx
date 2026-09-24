import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders untrusted Markdown (review comments). Safe by construction: raw HTML is dropped
 * (skipHtml), URLs with unsafe protocols (javascript:, data:, …) are removed, links open in a new
 * tab without opener access, and images are shown as text links (no tracking pixels).
 */
const components: Components = {
  a: ({ node: _node, href, children, ...rest }) =>
    href ? (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow">
        {alt || 'image'}
      </a>
    ) : (
      <span>{alt}</span>
    ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={defaultUrlTransform} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
