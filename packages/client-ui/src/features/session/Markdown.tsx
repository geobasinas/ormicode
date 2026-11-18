import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const inlineCode: React.CSSProperties = {
  background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 4px',
  fontFamily: 'var(--font-mono)', fontSize: 12,
};

function CodeBlock({ value, language }: { value: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ormi-markdown-code" style={{
      position: 'relative', margin: '8px 0', background: 'var(--bg-inset)',
      border: '1px solid var(--line-subtle)', borderRadius: 8, overflow: 'hidden',
    }}>
      <div className="ormi-markdown-code-toolbar" style={{
        position: 'absolute', top: 4, right: 5, display: 'flex', alignItems: 'center', gap: 7,
        color: 'var(--text-hint)', fontSize: 10, zIndex: 1,
      }}>
        {language ? <span>{language}</span> : null}
        <button type="button" aria-label="Copy code" title="Copy code" onClick={() => void copy()} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 4px',
          color: 'var(--text-hint)', background: 'var(--bg-card)', border: '1px solid var(--line-card)',
          borderRadius: 4, cursor: 'pointer', fontSize: 10,
        }}>{copied ? <><Check size={11} />Copied</> : <><Copy size={11} />Copy</>}</button>
      </div>
      <pre style={{ margin: 0, padding: '8px 10px', overflowX: 'auto', fontSize: 12, lineHeight: 1.5 }}>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{value}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  h1: ({ children }) => <h1 style={{ color: 'var(--text-title)', fontSize: 17, fontWeight: 600, margin: '12px 0 6px' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ color: 'var(--text-title)', fontSize: 15, fontWeight: 600, margin: '12px 0 6px' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ color: 'var(--text-title)', fontSize: 14, fontWeight: 600, margin: '12px 0 6px' }}>{children}</h3>,
  ul: ({ children, className }) => <ul className={className} style={{ paddingLeft: 18, margin: '4px 0 8px' }}>{children}</ul>,
  ol: ({ children, className }) => <ol className={className} style={{ paddingLeft: 18, margin: '4px 0 8px' }}>{children}</ol>,
  li: ({ children, className }) => <li className={className} style={{ margin: '3px 0' }}>{children}</li>,
  input: ({ type, checked }) => type === 'checkbox'
    ? <input type="checkbox" className="ormi-check" checked={Boolean(checked)} disabled aria-label={checked ? 'Completed task' : 'Incomplete task'} />
    : null,
  code: ({ children, className }) => {
    const language = /language-([^\s]+)/.exec(className ?? '')?.[1];
    return <code className={className} data-language={language} style={inlineCode}>{children}</code>;
  },
  pre: ({ children }) => {
    const child = Children.toArray(children).find(isValidElement);
    const props = child?.props as { children?: ReactNode; className?: string; 'data-language'?: string } | undefined;
    const language = props?.['data-language'] ?? /language-([^\s]+)/.exec(props?.className ?? '')?.[1] ?? '';
    return <CodeBlock language={language} value={String(props?.children ?? '').replace(/\n$/, '')} />;
  },
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%', width: 'max-content' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', padding: '5px 8px', textAlign: 'left' }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid var(--line-card)', padding: '5px 8px' }}>{children}</td>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid var(--line-card)', color: 'var(--text-secondary)', margin: '8px 0', paddingLeft: 10 }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--line-subtle)', margin: '12px 0' }} />,
  a: ({ children, href }) => <a href={href} onClick={event => {
    event.preventDefault();
    if (href && /^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  }} style={{ color: 'var(--text-title)', textDecoration: 'underline', textDecorationColor: 'var(--line-card)' }}>{children}</a>,
};

export function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className="ormi-markdown" style={{ color: muted ? 'var(--text-hint)' : 'var(--text-label)', fontSize: 14, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{text}</ReactMarkdown>
    </div>
  );
}
