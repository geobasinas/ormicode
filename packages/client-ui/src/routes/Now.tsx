/** Now route: the things needing attention — pending approvals and
 * running/paused sessions across the hub. */
import { useSessions } from '../features/session/useSessions.ts';
import { NewSession } from '../features/session/NewSession.tsx';
import { PairCard } from '../features/pair/PairCard.tsx';
import { ago, greeting } from '../lib/format.ts';

const attention = ['awaiting_approval', 'awaiting_input', 'paused_rate_limited', 'interrupted', 'failed'];
const working = ['running', 'starting', 'retrying'];

export function Now({ onOpen, state }: { onOpen: (session: string) => void; state?: string }) {
  const { sessions } = useSessions();
  const needs = sessions.filter(s => attention.includes(s.state));
  const live = sessions.filter(s => working.includes(s.state));
  const recent = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 5);
  const card = (s: typeof sessions[number], accent: string) => (
    <button key={s.id} onClick={() => onOpen(s.id)} style={{
      textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: 'var(--space-3)',
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
      borderLeft: `3px solid ${accent}`, color: 'var(--text-label)',
    }}>
      <div style={{ color: 'var(--text-active)', fontSize: 'var(--text-sm)' }}>{s.title || s.id.slice(0, 14)}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>{s.state}{s.vendor ? ` · ${s.vendor}` : ''} · {ago(s.updatedAt ?? 0)}</div>
    </button>
  );
  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', justifyContent: 'center' }}>
    <div style={{ width: '100%', maxWidth: 680, padding: 'var(--space-6) var(--space-5)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--text-title)', margin: '0 0 var(--space-4)', fontWeight: 500 }}>{greeting()}</h1>
      {state === 'unpaired' ? <PairCard /> : null}
      <NewSession onStarted={onOpen} />
      {needs.length ? (
        <>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', margin: 'var(--space-4) 0 var(--space-2)', letterSpacing: 1 }}>NEEDS YOU</div>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>{needs.map(s => card(s, 'var(--accent-amber)'))}</div>
        </>
      ) : null}
      {live.length ? (
        <>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', margin: 'var(--space-4) 0 var(--space-2)', letterSpacing: 1 }}>WORKING</div>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>{live.map(s => card(s, 'var(--accent-mint)'))}</div>
        </>
      ) : null}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', margin: 'var(--space-4) 0 var(--space-2)', letterSpacing: 1 }}>RECENT SESSIONS</div>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {recent.map(s => (
          <button key={s.id} onClick={() => onOpen(s.id)} style={{
            textAlign: 'left', font: 'inherit', cursor: 'pointer', padding: 'var(--space-2) var(--space-3)',
            background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', color: 'var(--text-label)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          }}>
            <span style={{ color: needs.includes(s) ? 'var(--accent-amber)' : 'var(--text-hint)', fontSize: 'var(--text-xs)', width: 12 }}>▶</span>
            <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-active)' }}>{s.title || s.id.slice(0, 14)}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>{s.project} · {ago(s.updatedAt ?? 0)}</span>
          </button>
        ))}
        {!recent.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>no sessions yet</div> : null}
      </div>
    </div>
    </div>
  );
}
