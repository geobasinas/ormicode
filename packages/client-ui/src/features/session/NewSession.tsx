/** New-session composer card: prompt + project/agent chips → session.start. */
import { useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown, Folder, Laptop } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';

const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];

const chip = {
  font: 'inherit', fontSize: 12, color: 'var(--text-label)',
  background: '#2a2a2a', border: 'none',
  borderRadius: 7, padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: 6,
};
const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex' };

export function NewSession({ onStarted }: { onStarted: (session: string) => void }) {
  const { transport } = usePlatform();
  const [text, setText] = useState('');
  const [vendor, setVendor] = useState('claude');
  const [project, setProject] = useState('scratch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
      setText('');
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
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
        placeholder="What do you want to work on?" rows={2}
        style={{
          width: '100%', resize: 'none', font: 'inherit', fontSize: 14,
          background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)',
          minHeight: 40,
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
            style={{ width: 84, font: 'inherit', fontSize: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
        </label>
        <span style={chip} title="this machine"><Laptop size={12} style={{ color: 'var(--text-hint)' }} />local</span>
        <span style={{ ...chip, padding: 0, position: 'relative' }}>
          <select value={vendor} onChange={e => setVendor(e.target.value)} style={{ font: 'inherit', fontSize: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', appearance: 'none', padding: '4px 24px 4px 9px' }}>
            {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-hint)' }} />
        </span>
        <button onClick={() => void send()} disabled={!text.trim() || busy} title="start session" style={{
          width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'var(--accent-mint)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.4,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ArrowUp size={16} strokeWidth={2.5} /></button>
      </div>
    </div>
  );
}
