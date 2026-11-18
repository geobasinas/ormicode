/** Session route: header, transcript, approvals surface, composer, and
 * side panels toggled from the app-level right rail (Notes first). */
import { useTranscript } from '../features/session/useTranscript.ts';
import { useSession } from '../features/session/useSession.ts';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { Composer } from '../features/session/Composer.tsx';
import { NotesPanel } from '../features/notes/NotesPanel.tsx';

export function SessionView({ session, rail = 'none' }: { session: string; rail?: 'none' | 'notes'; onRail?: (r: 'none' | 'notes') => void }) {
  const { events, approvals } = useTranscript(session);
  const details = useSession(session);
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <Transcript events={events} />
        <Approvals session={session} pending={approvals} />
        <Composer session={session} details={details} />
      </div>
      {rail === 'notes' ? (
        <div style={{ width: '50%', minWidth: 320, maxWidth: 560, flexShrink: 0, borderLeft: '1px solid var(--line-pane)', background: 'var(--bg-main)' }}>
          <NotesPanel session={session} />
        </div>
      ) : null}
    </div>
  );
}
