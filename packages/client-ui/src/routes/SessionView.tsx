/** Session route: header, transcript, approvals surface, composer, and
 * side panels toggled from the app-level right rail (Notes first). */
import { useTranscript } from '../features/session/useTranscript.ts';
import { useSession } from '../features/session/useSession.ts';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { Composer } from '../features/session/Composer.tsx';
import { NotesPanel } from '../features/notes/NotesPanel.tsx';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

export function SessionView({ session, rail = 'none' }: { session: string; rail?: 'none' | 'notes'; onRail?: (r: 'none' | 'notes') => void }) {
  const { events, approvals } = useTranscript(session);
  const details = useSession(session);
  const notesLayout = useDefaultLayout({ id: 'ormi.session.notes', storage: globalThis.localStorage });
  const chat = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <Transcript events={events} />
      <Approvals session={session} pending={approvals} />
      <Composer session={session} details={details} />
    </div>
  );
  if (rail !== 'notes') return <div style={{ height: '100%', background: 'var(--bg-main)' }}>{chat}</div>;
  return (
    <Group id="ormi.session.notes" orientation="horizontal" defaultLayout={notesLayout.defaultLayout} onLayoutChanged={notesLayout.onLayoutChanged} style={{ height: '100%', background: 'var(--bg-main)' }}>
      <Panel id="chat" minSize={360}>{chat}</Panel>
      <Separator className="ormi-handle ormi-handle-line" />
      <Panel id="notes" defaultSize="45" minSize={280} maxSize="70">
        <div style={{ height: '100%', background: 'var(--bg-main)' }}><NotesPanel session={session} /></div>
      </Panel>
    </Group>
  );
}
