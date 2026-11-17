/** Sidebar session list. */
import { useSessions } from './useSessions.ts';

const stateColor: Record<string, string> = {
  running: 'var(--accent-mint)', awaiting_approval: 'var(--accent-amber)', awaiting_input: 'var(--accent-amber)',
  interrupted: 'var(--accent-amber)', failed: 'var(--accent-red)', paused_rate_limited: 'var(--accent-amber)',
};

export function SessionList({ active, onSelect }: { active?: string; onSelect: (id: string) => void }) {
  const { sessions, error } = useSessions();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-hint)', letterSpacing: 1 }}>SESSIONS</div>
      {error ? <div style={{ padding: '0 var(--space-3)', color: 'var(--accent-red)', fontSize: 'var(--text-sm)' }}>{error}</div> : null}
      {sessions.map(s => (
        <button key={s.id} onClick={() => onSelect(s.id)} style={{
          textAlign: 'left', padding: '8px var(--space-3)', border: 'none', cursor: 'pointer', font: 'inherit',
          background: s.id === active ? 'var(--bg-card)' : 'transparent', color: 'var(--text-label)',
          borderLeft: s.id === active ? '2px solid var(--accent-mint)' : '2px solid transparent',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', color: s.id === active ? 'var(--text-active)' : undefined }}>
            {s.title || s.id.slice(0, 12)}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: stateColor[s.state] ?? 'var(--text-hint)' }}>
            {s.state}{s.vendor ? ` · ${s.vendor}` : ''}
          </div>
        </button>
      ))}
      {!sessions.length && !error ? <div style={{ padding: '0 var(--space-3)', color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>no sessions</div> : null}
    </div>
  );
}
