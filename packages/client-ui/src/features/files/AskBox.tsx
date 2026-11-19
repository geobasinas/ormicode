/**"Ask about this file": a prompt box under the viewer that starts a new
 *  session in the same project with the path and selected lines as context. */
import { useRef, useState } from 'react';
import { ArrowUp, X, MessageSquarePlus } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { useSession } from '../session/useSession.ts';
import { languageName } from './editor.ts';

export function AskBox({ session, path, sel, onClose, onStarted }: {
  session: string; path: string; sel: { from: number; to: number; text: string }; onClose: () => void; onStarted: (id: string) => void;
}) {
  const { transport } = usePlatform();
  const details = useSession(session);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);
  const range = sel.from === sel.to ? `line ${sel.from}` : `lines ${sel.from}–${sel.to}`;
  const send = async () => {
    const q = text.trim();
    if (!q || busy || !details) return;
    setBusy(true); setError(undefined);
    const res = await transport.request('session.start', {
      machine: newId('m'), project: details.project, vendor: details.vendor, transport: details.transport,
      model: details.model ?? 'default', effort: details.effort ?? 'default', mode: details.mode ?? 'default',
      workspace: { kind: details.project === 'scratch' ? 'scratch' : 'current' },
    });
    if (res.type === 'err') { setBusy(false); setError(String((res as { message?: string }).message ?? res.code)); return; }
    const id = (res.body as { session: string }).session;
    const fence = '```';
    const prompt = `About \`${path}\` ${range}:\n\n${fence}${languageName(path)}\n${sel.text.replace(/\n$/, '')}\n${fence}\n\n${q}`;
    void transport.request('session.prompt', { session: id, text: prompt });
    onStarted(id);
  };
  return (
    <div style={{ borderTop: '1px solid var(--line-subtle)', padding: '8px 10px 10px', flexShrink: 0, background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-hint)', marginBottom: 6 }}>
        <MessageSquarePlus size={12} style={{ flexShrink: 0 }} /><span>Ask a new session about <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-label)' }}>{path.slice(path.lastIndexOf('/') + 1)}</span> {range}</span>
        <span style={{ flex: 1 }} />
        <button title="Close" onClick={onClose} className="hv" style={{ border: 'none', background: 'transparent', color: 'var(--text-hint)', display: 'inline-flex', padding: 3, borderRadius: 5, cursor: 'pointer' }}><X size={12} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, padding: '7px 8px 7px 10px' }}>
        <textarea ref={area} autoFocus value={text} rows={2} placeholder="What should the agent do with these lines?" onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === 'Escape') onClose(); }}
          style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-title)', font: 'inherit', fontSize: 12.5, lineHeight: '18px' }} />
        <button aria-label="start session" disabled={!text.trim() || busy} onClick={() => void send()} style={{
          width: 24, height: 24, borderRadius: 999, border: 'none', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() && !busy ? 1 : 0.45, cursor: 'pointer',
        }}><ArrowUp size={13} /></button>
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 11, marginTop: 4 }}>{error}</div> : null}
    </div>
  );
}
