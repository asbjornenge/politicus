import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PREVIEW_CHARS = 280;

export function Markdown({ children, truncate = false }: { children: string; truncate?: boolean }) {
  let source = children;
  if (truncate && source.length > PREVIEW_CHARS) {
    source = source.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a target="_blank" rel="noopener noreferrer" {...props} />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
