/** Session route: transcript, approvals surface, composer. */
import { useTranscript } from '../features/session/useTranscript.ts';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { Composer } from '../features/session/Composer.tsx';

export function SessionView({ session }: { session: string }) {
  const { events, approvals } = useTranscript(session);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-main)' }}>
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--line-card)', fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
        {session}
      </div>
      <Transcript events={events} />
      <Approvals session={session} pending={approvals} />
      <Composer session={session} />
    </div>
  );
}
