/** Session route: header, transcript, approvals surface, composer, and
 * side panels toggled from the app-level right rail (Notes first). */
import { useTranscript } from '../features/session/useTranscript.ts';
import { useSession } from '../features/session/useSession.ts';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { Composer } from '../features/session/Composer.tsx';
import { NotesPanel } from '../features/notes/NotesPanel.tsx';
import { TerminalPane } from '../features/terminal/TerminalPane.tsx';
import { GitPane } from '../features/git/GitPane.tsx';
import type { RailPane } from './App.tsx';
import { History } from 'lucide-react';
import { projectName } from '../lib/format.ts';
import { stateLabel } from '../features/session/state.tsx';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

export function SessionView({ session, rail = 'none' }: { session: string; rail?: RailPane; onRail?: (r: RailPane) => void }) {
  const { events, approvals } = useTranscript(session);
  const details = useSession(session);
  const notesLayout = useDefaultLayout({ id: 'ormi.session.notes', storage: globalThis.localStorage });
  const chat = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      {details ? <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: '100%', maxWidth: 720, padding: '10px var(--space-5) 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-hint)' }}>
          <History size={11} />{[projectName(details.project), details.vendor, stateLabel(details.state)].join(' · ')}
        </div>
      </div> : null}
      <Transcript events={events} />
      <Approvals session={session} pending={approvals} />
      <Composer session={session} details={details} />
    </div>
  );
  if (rail === 'none') return <div style={{ height: '100%', background: 'var(--bg-main)' }}>{chat}</div>;
  return (
    <Group id="ormi.session.notes" orientation="horizontal" defaultLayout={notesLayout.defaultLayout} onLayoutChanged={notesLayout.onLayoutChanged} style={{ height: '100%', background: 'var(--bg-main)' }}>
      <Panel id="chat" minSize={360}>{chat}</Panel>
      <Separator className="ormi-handle ormi-handle-line" />
      <Panel id="notes" defaultSize="45" minSize={280} maxSize="70">
        <div style={{ height: '100%', background: 'var(--bg-main)' }}>
          {rail === 'notes' ? <NotesPanel session={session} /> : rail === 'git' ? <GitPane session={session} /> : <TerminalPane session={session} />}
        </div>
      </Panel>
    </Group>
  );
}
