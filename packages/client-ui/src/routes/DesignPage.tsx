import { useEffect, useState } from 'react';
import { ArrowUpRight, PanelsTopLeft } from 'lucide-react';
import { DesignWorkspace } from '../features/design/DesignWorkspace.tsx';
import { DesignAgentDock } from '../features/design/DesignAgentDock.tsx';
import type { SessionDetails } from '../features/session/useSession.ts';
import { usePlatform } from '../lib/platform.ts';
import { projectName } from '../lib/format.ts';

export function DesignPage({ initialSession, onSessionChange, onOpen, sidebarOpen, onShowSidebar, connection }: {
  initialSession?: string; onSessionChange(session: string): void; onOpen(session: string): void; sidebarOpen: boolean; onShowSidebar(): void; connection: string;
}) {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<SessionDetails[]>([]);
  const [selected, setSelected] = useState(initialSession ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(false);
  const online = connection === 'online' || (connection === 'connecting' && reachable);
  useEffect(() => { if (initialSession) setSelected(initialSession); }, [initialSession]);
  useEffect(() => {
    setReachable(false);
    let alive = true;
    let generation = 0;
    const refresh = async () => {
      const token = ++generation;
      try {
        const response = await transport.request('session.list', {});
        if (response.type === 'err') throw new Error(response.message);
        const listed = (response.body as { sessions: { id: string; project: string }[] }).sessions;
        const details = await Promise.all(listed.map(item => transport.request('session.get', { session: item.id })));
        if (!alive || token !== generation) return;
        setReachable(true);
        setSessions(previous => details.flatMap((item, index) => {
          const next = item.type === 'res' ? item.body as unknown as SessionDetails : previous.find(row => row.id === listed[index]?.id);
          return next ? [next] : [];
        }));
        setError('');
        setSelected(current => listed.some(item => item.id === current) ? current : listed[0]?.id ?? '');
      } catch (reason) { if (alive && token === generation) setError(String(reason)); }
      finally { if (alive && token === generation) setLoading(false); }
    };
    void refresh();
    const unsubscribe = transport.subscribeEvents(frame => { if (frame.type === 'idx') void refresh(); });
    return () => { alive = false; unsubscribe(); };
  }, [transport, connection]);
  const details = sessions.find(item => item.id === selected);
  const linkedSession = details?.id;
  useEffect(() => {
    if (!linkedSession || !online) return;
    transport.subscribe(linkedSession);
    return () => transport.unsubscribe(linkedSession);
  }, [transport, linkedSession, online]);
  if (!details) return <main aria-label="Design workspace" className="design-no-session">
    <div className="design-empty">
      <div className="design-empty-icon"><PanelsTopLeft size={24} /></div>
      <h1>{loading ? 'Loading sessions…' : 'Open a session to start designing'}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!loading ? <><p>Design boards are saved in the working folder of a Code session — project or scratch.</p>
        <button type="button" className="design-button primary" onClick={() => onOpen('now')}>Go to Code <ArrowUpRight size={14} /></button></> : null}
    </div>
  </main>;

  return <DesignWorkspace key={selected} session={selected} sidebarOpen={sidebarOpen} onShowSidebar={onShowSidebar}
    project={projectName(details.project)} workspacePath={details.cwd ?? details.project} sessionError={error}
    agentSlot={(board, sourceDirty) => <DesignAgentDock details={details} sessions={sessions} online={online} board={board} sourceDirty={sourceDirty} onOpen={onOpen}
      onChange={id => { setSelected(id); onSessionChange(id); }} />} />;
}
