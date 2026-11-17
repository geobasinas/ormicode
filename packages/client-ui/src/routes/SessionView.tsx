/** Session route: header, transcript, approvals surface, composer, and
 * the right icon rail — only panels that exist get an icon (Notes first). */
import { useState } from 'react';
import { useTranscript } from '../features/session/useTranscript.ts';
import { useSession } from '../features/session/useSession.ts';
import { SessionHeader } from '../features/session/SessionHeader.tsx';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { Composer } from '../features/session/Composer.tsx';
import { NotesPanel } from '../features/notes/NotesPanel.tsx';

export function SessionView({ session }: { session: string }) {
  const { events, approvals } = useTranscript(session);
  const details = useSession(session);
  const [rail, setRail] = useState<'none' | 'notes'>('none');
  const icon = (label: string, glyph: string, active: boolean, onClick: () => void) => (
    <button key={label} title={label} onClick={onClick} style={{
      width: 34, height: 34, font: 'inherit', fontSize: 15, cursor: 'pointer',
      color: active ? 'var(--text-active)' : 'var(--text-hint)',
      background: active ? 'var(--bg-raised)' : 'transparent',
      border: 'none', borderRadius: 'var(--radius-sm)',
    }}>{glyph}</button>
  );
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <SessionHeader session={session} details={details} />
        <Transcript events={events} />
        <Approvals session={session} pending={approvals} />
        <Composer session={session} details={details} />
      </div>
      {rail === 'notes' ? (
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid var(--line-card)', background: 'var(--bg-window)' }}>
          <NotesPanel session={session} />
        </div>
      ) : null}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
        padding: 'var(--space-2) var(--space-1)', borderLeft: '1px solid var(--line-pane)',
        background: 'var(--bg-window)', alignItems: 'center',
      }}>
        {icon('notes', '✎', rail === 'notes', () => setRail(rail === 'notes' ? 'none' : 'notes'))}
      </div>
    </div>
  );
}
