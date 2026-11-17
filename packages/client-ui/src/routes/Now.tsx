/** Now route: greeting, start composer, then two mockup-style columns —
 * recent sessions on the left, attention/working items on the right. */
import { Play, CircleAlert, LoaderCircle, GitBranch, type LucideIcon } from 'lucide-react';
import { useSessions, type SessionSummary } from '../features/session/useSessions.ts';
import { NewSession } from '../features/session/NewSession.tsx';
import { PairCard } from '../features/pair/PairCard.tsx';
import { ago, greeting } from '../lib/format.ts';

const attention = ['awaiting_approval', 'awaiting_input', 'paused_rate_limited', 'interrupted', 'failed'];
const working = ['running', 'starting', 'retrying'];

const stateGlyph: Record<string, { icon: LucideIcon; color: string }> = {
  running: { icon: Play, color: 'var(--accent-mint)' },
  starting: { icon: LoaderCircle, color: 'var(--accent-mint)' },
  retrying: { icon: LoaderCircle, color: 'var(--accent-amber)' },
  awaiting_approval: { icon: CircleAlert, color: 'var(--accent-amber)' },
  awaiting_input: { icon: CircleAlert, color: 'var(--accent-amber)' },
  paused_rate_limited: { icon: CircleAlert, color: 'var(--accent-amber)' },
  interrupted: { icon: CircleAlert, color: 'var(--accent-amber)' },
  failed: { icon: CircleAlert, color: 'var(--accent-red)' },
};

const rowIcon = (s: SessionSummary) => stateGlyph[s.state] ?? { icon: Play, color: 'var(--text-hint)' };

function SessionRow({ s, onOpen }: { s: SessionSummary; onOpen: (id: string) => void }) {
  const { icon: Icon, color } = rowIcon(s);
  return (
    <button onClick={() => onOpen(s.id)} style={{
      textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
      padding: '7px 10px', background: 'transparent', border: 'none',
      borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 14)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
          {s.project}
          <GitBranch size={10} />
          {s.state}
        </span>
      </span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
    </button>
  );
}

export function Now({ onOpen, state }: { onOpen: (session: string) => void; state?: string }) {
  const { sessions } = useSessions();
  const needs = sessions.filter(s => attention.includes(s.state));
  const live = sessions.filter(s => working.includes(s.state));
  const recent = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 5);
  const right = [...needs, ...live].slice(0, 5);
  const head = { fontSize: 'var(--text-xs)', color: 'var(--text-hint)', letterSpacing: 1, margin: '0 0 4px 10px' };
  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, padding: 'var(--space-6) var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--text-title)', margin: '0 0 var(--space-4)', fontWeight: 500 }}>{greeting()}</h1>
        {state === 'unpaired' ? <PairCard /> : null}
        <NewSession onStarted={onOpen} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
          <div>
            <div style={head}>RECENT SESSIONS</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)', padding: 4 }}>
              {recent.map(s => <SessionRow key={s.id} s={s} onOpen={onOpen} />)}
              {!recent.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>no sessions yet</div> : null}
            </div>
          </div>
          <div>
            <div style={head}>NEEDS YOU</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)', padding: 4 }}>
              {right.map(s => <SessionRow key={s.id} s={s} onOpen={onOpen} />)}
              {!right.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>nothing waiting on you</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
