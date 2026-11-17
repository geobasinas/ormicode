/** New-session composer card: prompt + project/agent chips → session.start. */
import { useState } from 'react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';

const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];

const chip = {
  font: 'inherit', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
  background: 'var(--bg-raised)', border: '1px solid var(--line-card)',
  borderRadius: 'var(--radius-sm)', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
};

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
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3)', maxWidth: 640,
    }}>
      <textarea
        value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
        placeholder="What do you want to work on?" rows={3}
        style={{
          width: '100%', resize: 'none', font: 'inherit', fontSize: 'var(--text-md)',
          background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)',
        }}
      />
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>{error}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <input value={project} onChange={e => setProject(e.target.value)} title="project path or 'scratch'"
          style={{ ...chip, width: 140, border: '1px solid var(--line-card)', background: 'var(--bg-raised)', color: 'var(--text-label)' }} />
        <select value={vendor} onChange={e => setVendor(e.target.value)} style={{ ...chip, cursor: 'pointer' }}>
          {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={() => void send()} disabled={!text.trim() || busy} title="start session" style={{
          width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 14,
          background: 'var(--accent-mint)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.4,
        }}>↑</button>
      </div>
    </div>
  );
}
