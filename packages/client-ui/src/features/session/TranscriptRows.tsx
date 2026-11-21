import { useState } from 'react';
import { ArrowRight, ChevronRight, CircleAlert } from 'lucide-react';
import { Markdown } from './Markdown.tsx';

export function ErrorRow({ message, onHandoff }: { message: string; onHandoff?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const preview = message.replace(/\s+/g, ' ').trim();
  return <div style={{ margin: '2px 0', fontSize: 12, lineHeight: '18px', color: 'var(--accent-red)' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} style={{
      display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0,
      border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer',
    }}>
      <CircleAlert size={12} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>
      <ChevronRight size={11} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} />
    </button>
    {expanded ? <div style={{ margin: '3px 0 4px 18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}
      {onHandoff ? <button type="button" onClick={onHandoff} style={{ display: 'block', marginTop: 5, border: 0, background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', fontSize: 11, padding: 0, cursor: 'pointer' }}>Try with another agent</button> : null}
    </div> : null}
  </div>;
}

export function HandoffRow({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return <div style={{ margin: '3px 0' }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, border: 0,
      background: 'transparent', color: 'var(--text-hint)', fontSize: 12, cursor: 'pointer',
    }}><ArrowRight size={12} />Handoff brief <ChevronRight size={11} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} /></button>
    {expanded ? <div style={{ margin: '4px 0 5px 18px' }}><Markdown text={text} size={12} /></div> : null}
  </div>;
}
