/** New-session composer card: prompt + project/machine/agent chips → session.start.
 *  Enter sends, Shift+Enter newline; the textarea grows with the prompt. */
import { useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown, Folder, Laptop } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';

const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];

const chip = {
  font: 'inherit', fontSize: 12, color: 'var(--text-label)',
  background: 'var(--bg-chip)', border: 'none',
  borderRadius: 7, padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 6,
};
const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex' };

export function NewSession({ onStarted }: { onStarted: (session: string) => void }) {
  const { transport } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [vendor, setVendor] = useState('claude');
  const [project, setProject] = useState('scratch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(undefined);
    try {
      const res = await transport.request('session.start', {
        machine: newId('m'), project, vendor, transport: 'cli',
        model: 'default', effort: 'default', mode: 'default',
        workspace: { kind: project === 'scratch' ? 'scratch' : 'current' },
      });
      if (res.type === 'err') { setError(res.message); setBusy(false); return; }
      const session = (res.body as { session: string }).session;
      setText(''); grow();
      void transport.request('session.prompt', { session, text: t });
      onStarted(session);
    } catch (e) { setError(String(e)); setBusy(false); }
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 12,
      padding: '14px 14px 10px', width: '100%',
    }}>
      <textarea
        ref={area}
        value={text}
        onChange={e => { setText(e.target.value); grow(); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        placeholder="What do you want to work on?" rows={1}
        style={{
          width: '100%', resize: 'none', font: 'inherit', fontSize: 14, lineHeight: 1.5,
          background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)',
          minHeight: 42, maxHeight: 168, overflow: 'hidden',
        }}
      />
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>{error}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={iconBtn} title="attach (soon)"><Plus size={17} /></button>
        <button style={iconBtn} title="mention (soon)"><AtSign size={16} /></button>
        <button style={iconBtn} title="voice (soon)"><Mic size={16} /></button>
        <span style={{ flex: 1 }} />
        <label style={{ ...chip, cursor: 'text' }} title="project path or 'scratch'">
          <Folder size={12} style={{ color: 'var(--text-hint)' }} />
          <input value={project} onChange={e => setProject(e.target.value)}
            style={{ width: 72, font: 'inherit', fontSize: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
          <ChevronDown size={12} style={{ color: 'var(--text-hint)' }} />
        </label>
        <span style={chip} title="this machine"><Laptop size={12} style={{ color: 'var(--text-hint)' }} />local<ChevronDown size={12} style={{ color: 'var(--text-hint)' }} /></span>
        <span style={{ ...chip, padding: 0, position: 'relative' }} title="agent">
          <select value={vendor} onChange={e => setVendor(e.target.value)} style={{ font: 'inherit', fontSize: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', appearance: 'none', height: 24, padding: '0 24px 0 9px' }}>
            {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-hint)' }} />
        </span>
        <button onClick={() => void send()} disabled={!text.trim() || busy} title="start session" style={{
          width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2,
          background: 'var(--text-title)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.4,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ArrowUp size={15} strokeWidth={2.5} /></button>
      </div>
    </div>
  );
}
