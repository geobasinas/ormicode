/** Prompt composer — session.prompt on Enter. */
import { useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { Button } from '../../components/Button.tsx';

export function Composer({ session }: { session: string }) {
  const { transport } = usePlatform();
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim(); if (!t) return;
    setText('');
    void transport.request('session.prompt', { session, text: t });
  };
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', borderTop: '1px solid var(--line-card)', background: 'var(--bg-card)' }}>
      <input
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder="prompt…" aria-label="prompt"
        style={{
          flex: 1, font: 'inherit', fontSize: 'var(--text-sm)', color: 'var(--text-active)',
          background: 'var(--bg-inset)', border: '1px solid var(--line-card)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px', outline: 'none',
        }}
      />
      <Button variant="primary" onClick={send}>send</Button>
    </div>
  );
}
