/** Prompt composer — session.prompt on Enter. Chips show what the
 * session runs; pickers arrive when the protocol exposes pickers. */
import { useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from './useSession.ts';

export function Composer({ session, details }: { session: string; details?: SessionDetails }) {
  const { transport } = usePlatform();
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim(); if (!t) return;
    setText('');
    void transport.request('session.prompt', { session, text: t });
  };
  const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', fontSize: 15, cursor: 'pointer', padding: '2px 4px' };
  const chip = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' };
  return (
    <div style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
      <div style={{
        width: '100%', maxWidth: 720, background: 'var(--bg-card)', border: '1px solid var(--line-card)',
        borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)',
      }}>
        <input
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="prompt…" aria-label="prompt"
          style={{
            width: '100%', font: 'inherit', fontSize: 'var(--text-sm)', color: 'var(--text-active)',
            background: 'transparent', border: 'none', outline: 'none', padding: '6px 0',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button style={iconBtn} title="attach (soon)">+</button>
          <button style={iconBtn} title="mention (soon)">@</button>
          <button style={iconBtn} title="voice (soon)">◉</button>
          <span style={{ flex: 1 }} />
          {details?.vendor ? <span style={chip}>{details.vendor}</span> : null}
          {details?.model ? <span style={chip}>{details.model}{details.effort ? ` ${details.effort}` : ''}</span> : null}
          <button onClick={send} title="send" style={{
            width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 13,
            background: 'var(--accent-mint)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.4,
          }}>↑</button>
        </div>
      </div>
    </div>
  );
}
