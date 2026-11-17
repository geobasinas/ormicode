/** Now route: the things needing attention — pending approvals and
 * running/paused sessions across the hub. */
import { useSessions } from '../features/session/useSessions.ts';
import { PairCard } from '../features/pair/PairCard.tsx';

const attention = ['awaiting_approval', 'awaiting_input', 'paused_rate_limited', 'interrupted', 'failed'];
const working = ['running', 'starting', 'retrying'];

export function Now({ onOpen, state }: { onOpen: (session: string) => void; state?: string }) {
  const { sessions } = useSessions();
  const needs = sessions.filter(s => attention.includes(s.state));
  const live = sessions.filter(s => working.includes(s.state));
  const card = (s: typeof sessions[number], accent: string) => (
    <button key={s.id} onClick={() => onOpen(s.id)} style={{
      textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: 'var(--space-3)',
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
      borderLeft: `3px solid ${accent}`, color: 'var(--text-label)',
    }}>
      <div style={{ color: 'var(--text-active)', fontSize: 'var(--text-sm)' }}>{s.title || s.id.slice(0, 14)}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>{s.state}{s.vendor ? ` · ${s.vendor}` : ''}</div>
    </button>
  );
  return (
    <div style={{ padding: 'var(--space-5)', overflow: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--text-title)', margin: '0 0 var(--space-4)' }}>Now</h1>
      {state === 'unpaired' ? <PairCard /> : null}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', marginBottom: 'var(--space-2)' }}>NEEDS YOU</div>
      <div style={{ display: 'grid', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {needs.map(s => card(s, 'var(--accent-amber)'))}
        {!needs.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>nothing waiting</div> : null}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', marginBottom: 'var(--space-2)' }}>WORKING</div>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {live.map(s => card(s, 'var(--accent-mint)'))}
        {!live.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>nothing running</div> : null}
      </div>
    </div>
  );
}
