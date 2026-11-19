import { useEffect, useState } from 'react';
import { ArrowUpRight, GitBranch, PanelsTopLeft, Workflow } from 'lucide-react';
import { DesignWorkspace } from '../features/design/DesignWorkspace.tsx';
import { Composer } from '../features/session/Composer.tsx';
import type { SessionDetails } from '../features/session/useSession.ts';
import { usePlatform } from '../lib/platform.ts';
import { projectName } from '../lib/format.ts';

export function DesignPage({ initialSession, onSessionChange, onOpen, sidebarOpen, onShowSidebar }: {
  initialSession?: string; onSessionChange(session: string): void; onOpen(session: string): void; sidebarOpen: boolean; onShowSidebar(): void;
}) {
  const { transport } = usePlatform();
  const [sessions, setSessions] = useState<SessionDetails[]>([]);
  const [selected, setSelected] = useState(initialSession ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
      finally { if (alive && token === generation) setLoading(false); }
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
  if (!details) return <main aria-label="Design workspace" className="design-no-session">
    <div className="design-empty">
      <div className="design-empty-icon"><PanelsTopLeft size={24} /></div>
      <h1>{loading ? 'Loading project sessions…' : 'Open a project to start designing'}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!loading ? <><p>Design boards are saved in the working tree of a Code session.</p>
        <button type="button" className="design-button primary" onClick={() => onOpen('now')}>Go to Code <ArrowUpRight size={14} /></button></> : null}
    </div>
  </main>;

  const sameWorkspace = sessions.filter(item => item.cwd === details.cwd);
  const otherWorkspaces = sessions.filter(item => item.cwd !== details.cwd);
  const sessionChoice = (item: SessionDetails) => <option key={item.id} value={item.id}>
    {item.title ?? item.id} · {projectName(item.project)}{item.branch ? ` · ${item.branch}` : ''}
  </option>;

  return <DesignWorkspace key={selected} session={selected} sidebarOpen={sidebarOpen} onShowSidebar={onShowSidebar}
    project={projectName(details.project)} workspacePath={details.cwd ?? details.project} sessionError={error} agentSlot={
      <div className="design-agent">
        <div className="design-section-heading"><Workflow size={13} /> <span>Linked session</span>
          <button type="button" className="design-icon-button" aria-label="Open session chat" title="Open session chat" onClick={() => onOpen(selected)}><ArrowUpRight size={15} /></button>
        </div>
        <select aria-label="Design project and session" className="design-input design-session-select" title={details.title ?? selected} value={selected}
          onChange={event => { setSelected(event.target.value); onSessionChange(event.target.value); }}>
          <optgroup label="This working tree">{sameWorkspace.map(sessionChoice)}</optgroup>
          {otherWorkspaces.length ? <optgroup label="Other working trees">{otherWorkspaces.map(sessionChoice)}</optgroup> : null}
        </select>
        <div className="design-branch" title={details.cwd}><GitBranch size={12} /> <span>{details.branch ?? details.cwd}</span></div>
        <Composer session={selected} details={details} compact />
      </div>
    } />;
}
