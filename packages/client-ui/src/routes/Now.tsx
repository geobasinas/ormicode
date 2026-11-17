/** Now route: greeting, start composer, then two mockup-style columns —
 * recent sessions on the left, attention/working items on the right. */
import { Play, CircleAlert, LoaderCircle, GitBranch, Folder, type LucideIcon } from 'lucide-react';
import { useSessions, type SessionSummary } from '../features/session/useSessions.ts';
import { NewSession } from '../features/session/NewSession.tsx';
import { PairCard } from '../features/pair/PairCard.tsx';
import { ago, greeting, projectName } from '../lib/format.ts';

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

const cardBox = {
  background: 'var(--bg-card)', border: '1px solid var(--line-card)',
  borderRadius: 'var(--radius-md)', padding: 4, overflow: 'hidden' as const,
};
const head = { fontSize: 11, color: 'var(--text-hint)', letterSpacing: 1.2, margin: '0 0 6px 10px' };

function SessionRow({ s, onOpen }: { s: SessionSummary; onOpen: (id: string) => void }) {
  const { icon: Icon, color } = rowIcon(s);
  return (
    <button onClick={() => onOpen(s.id)} style={{
      textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
      padding: '8px 12px', background: 'transparent', border: 'none',
      borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 14)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-hint)', marginTop: 1 }}>
          <Folder size={10} />{projectName(s.project)}
          <GitBranch size={10} style={{ marginLeft: 4 }} />{s.state}
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-hint)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
    </button>
  );
}

function AttentionRow({ s, n, onOpen }: { s: SessionSummary; n: number; onOpen: (id: string) => void }) {
  const needs = attention.includes(s.state);
  return (
    <button onClick={() => onOpen(s.id)} style={{
      textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
      padding: '8px 12px', background: 'transparent', border: 'none',
      borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', background: '#2f2f2f',
        color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
      }}>{n}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 14)}</span>
        <span style={{ display: 'block', fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: needs ? 'var(--accent-amber)' : 'var(--text-hint)' }}>
          {s.state.replace(/_/g, ' ')}
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-hint)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
    </button>
  );
}

export function Now({ onOpen, state }: { onOpen: (session: string) => void; state?: string }) {
  const { sessions } = useSessions();
  const needs = sessions.filter(s => attention.includes(s.state));
  const live = sessions.filter(s => working.includes(s.state));
  const recent = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 5);
  const right = [...needs, ...live].slice(0, 5);
  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 780, padding: '14vh var(--space-5) var(--space-6)' }}>
        <h1 style={{ fontSize: 26, color: 'var(--text-title)', margin: '0 0 var(--space-4)', fontWeight: 600, letterSpacing: -0.3 }}>{greeting()}</h1>
        {state === 'unpaired' ? <PairCard /> : null}
        <NewSession onStarted={onOpen} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-5)' }}>
          <div>
            <div style={head}>RECENT SESSIONS</div>
            <div style={cardBox}>
              {recent.map(s => <SessionRow key={s.id} s={s} onOpen={onOpen} />)}
              {!recent.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>no sessions yet</div> : null}
            </div>
          </div>
          <div>
            <div style={head}>NEEDS YOU</div>
            <div style={cardBox}>
              {right.map((s, i) => <AttentionRow key={s.id} s={s} n={i + 1} onOpen={onOpen} />)}
              {!right.length ? <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>nothing waiting on you</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
