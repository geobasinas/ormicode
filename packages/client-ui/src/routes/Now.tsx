/** Now route: greeting, start composer, then two mockup-style columns —
 * recent sessions on the left, sessions that need you or are working on the right. */
import { useSessions, type SessionSummary } from '../features/session/useSessions.ts';
import { NewSession } from '../features/session/NewSession.tsx';
import { PairCard } from '../features/pair/PairCard.tsx';
import { StateIcon, NEEDS_YOU, LIVE, stateLabel, whereLine } from '../features/session/state.tsx';
import { ago, greeting, projectName } from '../lib/format.ts';

const cardBox = {
  background: 'var(--bg-card)', border: '1px solid var(--line-card)',
  borderRadius: 12, padding: 3, overflow: 'hidden' as const,
};
const head = { fontSize: 10, fontWeight: 600, color: 'var(--text-label)', letterSpacing: 1, margin: '0 0 6px 0' };
const rowBtn = {
  textAlign: 'left' as const, font: 'inherit', cursor: 'pointer', width: '100%', height: 38,
  padding: '0 12px 0 9px', background: 'transparent', border: 'none',
  borderRadius: 9, display: 'flex', alignItems: 'center', gap: 13,
};
const title = (s: SessionSummary, first: boolean) => (
  <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: first ? 'var(--text-title)' : '#cbcbcb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 14)}</span>
);

function SessionRow({ s, first, onOpen }: { s: SessionSummary; first: boolean; onOpen: (id: string) => void }) {
  return (
    <button className="hv-row" onClick={() => onOpen(s.id)} style={rowBtn}>
      <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center' }}><StateIcon state={s.state} size={12} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {title(s, first)}
        <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.project === 'scratch' ? whereLine(s) : whereLine(s, projectName(s.project))}
        </span>
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
    </button>
  );
}

function AttentionRow({ s, n, onOpen }: { s: SessionSummary; n: number; onOpen: (id: string) => void }) {
  const needs = NEEDS_YOU.has(s.state);
  return (
    <button className="hv-row" onClick={() => onOpen(s.id)} style={rowBtn}>
      <span style={{
        width: 20, height: 20, borderRadius: 7, flexShrink: 0, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', background: 'var(--bg-badge)',
        color: 'var(--text-onAccent)', fontSize: 10, fontWeight: 700,
      }}>{n}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {title(s, n === 1)}
        <span style={{ display: 'block', fontSize: 10.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: needs ? 'var(--accent-amber)' : 'var(--text-secondary)' }}>
          {stateLabel(s.state)} · {projectName(s.project)}
        </span>
      </span>
      <StateIcon state={s.state} size={12} />
    </button>
  );
}

export function Now({ onOpen, state }: { onOpen: (session: string) => void; state?: string }) {
  const { sessions } = useSessions();
  const needs = sessions.filter(s => NEEDS_YOU.has(s.state)).sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  const live = sessions.filter(s => LIVE.has(s.state));
  const recent = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 4);
  const right = [...needs, ...live].slice(0, 4);
  const empty = (t: string) => <div style={{ color: 'var(--text-secondary)', fontSize: 12, height: 38, display: 'flex', alignItems: 'center', padding: '0 12px' }}>{t}</div>;
  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 792, padding: '0 var(--space-5)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-title)', margin: '0 0 15px', fontWeight: 600, letterSpacing: -0.3 }}>{greeting()}</h1>
        {state === 'unpaired' ? <PairCard /> : null}
        <NewSession onStarted={onOpen} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div>
            <div style={head}>RECENT SESSIONS</div>
            <div style={cardBox}>
              {recent.map((s, i) => <SessionRow key={s.id} s={s} first={i === 0} onOpen={onOpen} />)}
              {!recent.length ? empty('No sessions yet. Start one above.') : null}
            </div>
          </div>
          <div>
            <div style={head}>NEEDS YOU</div>
            <div style={cardBox}>
              {right.map((s, i) => <AttentionRow key={s.id} s={s} n={i + 1} onOpen={onOpen} />)}
              {!right.length ? empty('Nothing waiting on you') : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
