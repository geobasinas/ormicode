/** Prompt composer — session.prompt on Enter (Shift+Enter for newline).
 * Chips show what the session runs; pickers arrive when the protocol exposes them. */
import { useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from './useSession.ts';

export function Composer({ session, details }: { session: string; details?: SessionDetails }) {
  const { transport } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };
  const send = () => {
    const t = text.trim(); if (!t) return;
    setText(''); grow();
    void transport.request('session.prompt', { session, text: t });
  };
  const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex' };
  const chip = { fontSize: 'var(--text-xs)', color: 'var(--text-label)', background: 'var(--bg-chip)', border: 'none', borderRadius: 7, padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 5 };
  return (
    <div style={{ padding: '0 var(--space-5) var(--space-4)', display: 'flex', justifyContent: 'center' }}>
      <div style={{
        width: '100%', maxWidth: 680, background: 'var(--bg-card)', border: '1px solid var(--line-card)',
        borderRadius: 12, padding: '10px 12px 8px',
      }}>
        <textarea
          ref={area}
          value={text}
          onChange={e => { setText(e.target.value); grow(); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="prompt…" aria-label="prompt" rows={1}
          style={{
            width: '100%', resize: 'none', font: 'inherit', fontSize: 'var(--text-sm)', lineHeight: 1.5,
            color: 'var(--text-active)', background: 'transparent', border: 'none', outline: 'none',
            padding: '6px 0', maxHeight: 168, overflow: 'hidden',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button style={iconBtn} title="attach (soon)"><Plus size={16} /></button>
          <button style={iconBtn} title="mention (soon)"><AtSign size={15} /></button>
          <button style={iconBtn} title="voice (soon)"><Mic size={15} /></button>
          <span style={{ flex: 1 }} />
          {details?.vendor ? <span style={chip}>{details.vendor}<ChevronDown size={11} style={{ color: 'var(--text-hint)' }} /></span> : null}
          {details?.model ? <span style={chip}>{details.model}{details.effort ? ` ${details.effort}` : ''}<ChevronDown size={11} style={{ color: 'var(--text-hint)' }} /></span> : null}
          <button onClick={send} title="send" style={{
            width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2,
            background: 'var(--text-title)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><ArrowUp size={15} strokeWidth={2.5} /></button>
        </div>
      </div>
    </div>
  );
}
