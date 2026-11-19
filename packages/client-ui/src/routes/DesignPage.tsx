import { useEffect, useState } from 'react';
import { DesignWorkspace } from '../features/design/DesignWorkspace.tsx';
import { Composer } from '../features/session/Composer.tsx';
import type { SessionDetails } from '../features/session/useSession.ts';
import { usePlatform } from '../lib/platform.ts';
import { projectName } from '../lib/format.ts';

export function DesignPage({ initialSession, onSessionChange, onOpen }: {
  initialSession?: string; onSessionChange(session: string): void; onOpen(session: string): void;
}) {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<SessionDetails[]>([]);
  const [selected, setSelected] = useState(initialSession ?? '');
  const [error, setError] = useState('');
  useEffect(() => { if (initialSession) setSelected(initialSession); }, [initialSession]);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const refresh = async () => {
      const token = ++generation;
      try {
        const response = await transport.request('session.list', {});
        if (response.type === 'err') throw new Error(response.message);
        const listed = (response.body as { sessions: { id: string; project: string }[] }).sessions.filter(item => item.project !== 'scratch');
        const details = await Promise.all(listed.map(item => transport.request('session.get', { session: item.id })));
        if (!alive || token !== generation) return;
        const next = details.flatMap(item => item.type === 'res' ? [item.body as unknown as SessionDetails] : []);
        setSessions(next); setError('');
        setSelected(current => next.some(item => item.id === current) ? current : next[0]?.id ?? '');
      } catch (reason) { if (alive && token === generation) setError(String(reason)); }
    };
    void refresh();
    const unsubscribe = transport.subscribeEvents(frame => { if (frame.type === 'idx') void refresh(); });
    return () => { alive = false; unsubscribe(); };
  }, [transport]);
  useEffect(() => {
    if (!selected) return;
    transport.subscribe(selected);
    return () => transport.unsubscribe(selected);
  }, [transport, selected]);
  const details = sessions.find(item => item.id === selected);
  const linked = details ? sessions.filter(item => item.cwd === details.cwd) : [];
  const button = { border: '1px solid var(--line-divider)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-label)', padding: '5px 8px', cursor: 'pointer', font: 'inherit' };
  return <section aria-label="Design workspace" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'var(--text-title)', fontSize: 12 }}>
    <header style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-divider)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <strong>Design workspace</strong>
      <label>Project / session <select aria-label="Design project and session" value={selected} onChange={event => { setSelected(event.target.value); onSessionChange(event.target.value); }} style={{ ...button, maxWidth: 440 }}>
        {!sessions.length ? <option value="">Choose a project session</option> : null}
        {sessions.map(item => <option key={item.id} value={item.id}>{projectName(item.project)} · {item.branch ?? 'current workspace'} · {item.title ?? item.id}</option>)}
      </select></label>
      {details ? <button style={button} onClick={() => onOpen(selected)}>Open session chat</button> : null}
      {details ? <div style={{ width: '100%', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>Board storage: {details.cwd}/designs/ · Associated sessions: {linked.map(item => <button key={item.id} style={{ ...button, marginRight: 4 }} onClick={() => onOpen(item.id)}>{item.title ?? item.id}</button>)}</div> : null}
    </header>
    {error ? <p role="alert" style={{ padding: 12, color: 'var(--accent-red)' }}>{error}</p> : null}
    {details ? <>
      <div style={{ flex: 1, minHeight: 0 }}><DesignWorkspace key={selected} session={selected} /></div>
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--line-divider)' }}><Composer key={selected} session={selected} details={details} /></div>
    </> : <div style={{ padding: 32, margin: 'auto', maxWidth: 520 }}><h2>Design in a project workspace</h2><p>Start or open a project session first, then choose it here. Its working directory determines which repository-backed boards are listed. Worktrees stay separate, and feedback is sent only when you submit the linked session's composer.</p></div>}
  </section>;
}
