/** Now route: greeting, start composer, then two mockup-style columns —
 * recent sessions on the left, sessions that need you on the right. */
import { useSessions, type SessionSummary } from '../features/session/useSessions.ts';
import { NewSession } from '../features/session/NewSession.tsx';
import { StateIcon, whereLine } from '../features/session/state.tsx';
import { useDigest, type DigestEntry } from '../features/session/useDigest.ts';
import { ago, greeting, projectName } from '../lib/format.ts';
import { needsAttention, attentionReason } from '../features/session/attention.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';

const cardBox = {
  background: 'var(--bg-card)', border: '1px solid var(--line-card)',
  borderRadius: 12, padding: 3, overflow: 'hidden' as const,
};
const head = { fontSize: 10, fontWeight: 500, color: 'var(--text-label)', letterSpacing: 1, margin: '0 0 6px 0' };
const rowBtn = {
  textAlign: 'left' as const, font: 'inherit', cursor: 'pointer', width: '100%', height: 38,
  padding: '0 12px 0 9px', background: 'transparent', border: 'none',
  borderRadius: 9, display: 'flex', alignItems: 'center', gap: 13,
};
const title = (s: SessionSummary, first: boolean) => (
  <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: first ? 'var(--text-title)' : 'var(--text-label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 14)}</span>
);

function SessionRow({ s, first, onOpen }: { s: SessionSummary; first: boolean; onOpen: (id: string) => void }) {
  return (
    <button className="hv-row" onClick={() => onOpen(s.id)} style={rowBtn}>
      <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center' }}><StateIcon state={s.state} size={12} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {title(s, first)}
        <span title={s.branch ?? undefined} style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.project === 'scratch' ? whereLine(s) : whereLine(s, projectName(s.project))}
        </span>
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
    </button>
  );
}

type DigestHighlight = Exclude<DigestEntry, { rank: 'silent' }>;

function attentionLine(s: SessionSummary, entry?: DigestHighlight): string {
  return `${attentionReason(s, entry)} · ${entry?.wants ? ago(entry.wants.since) : projectName(s.project)}`;
}

function AttentionRow({ s, n, entry, onOpen }: { s: SessionSummary; n: number; entry?: DigestHighlight; onOpen: (id: string) => void }) {
  const color = 'var(--accent-amber)';
  return (
    <button className="hv-row" title={entry?.changed.result} onClick={() => onOpen(s.id)} style={rowBtn}>
      <span style={{
        width: 20, height: 20, borderRadius: 7, flexShrink: 0, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', background: 'var(--bg-badge)',
        color: 'var(--text-onAccent)', fontSize: 10, fontWeight: 700,
      }}>{n}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {title(s, n === 1)}
        <span style={{ display: 'block', fontSize: 10.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color }}>
          {attentionLine(s, entry)}
        </span>
      </span>
      <StateIcon state={s.state} size={12} />
    </button>
  );
}

export function Now({ onOpen, layout }: { onOpen: (session: string) => void; layout?: LayoutDescriptor }) {
  const { sessions } = useSessions();
  const digest = useDigest(sessions);
  const sessionsById = new Map(sessions.map(s => [s.id, s]));
  const rows: { s: SessionSummary; entry?: DigestHighlight }[] = [];
  const listed = new Set<string>();
  for (const entry of digest) {
    if (entry.rank === 'silent') continue;
    const s = sessionsById.get(entry.session);
    if (!s || !needsAttention(s, entry) || listed.has(s.id)) continue;
    rows.push({ s, entry }); listed.add(s.id);
  }
  for (const s of sessions) {
    if (rows.length >= 5) break;
    if (needsAttention(s) && !listed.has(s.id)) { rows.push({ s }); listed.add(s.id); }
  }
  const recent = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 4);
  const right = rows.slice(0, 5);
  const configuredWidgets = layout?.regions['now.widgets']?.widgets;
  const widgets = configuredWidgets?.filter(widget => widget === 'recent' || widget === 'needs') ?? ['recent', 'needs'];
  const empty = (t: string) => <div style={{ color: 'var(--text-secondary)', fontSize: 12, height: 38, display: 'flex', alignItems: 'center', padding: '0 12px' }}>{t}</div>;
  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 792, padding: '0 var(--space-5)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-title)', margin: '0 0 15px', fontWeight: 600, letterSpacing: -0.3 }}>{greeting()}</h1>
        <NewSession onStarted={onOpen} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          {widgets.map(widget => widget === 'needs' ? <div key="needs">
            <div style={head}>NEEDS YOU</div>
            <div style={cardBox}>
              {right.map(({ s, entry }, i) => <AttentionRow key={s.id} s={s} n={i + 1} entry={entry} onOpen={onOpen} />)}
              {!right.length ? empty('All clear. Nothing needs you.') : null}
            </div>
          </div> : <div key="recent">
            <div style={head}>RECENT SESSIONS</div>
            <div style={cardBox}>
              {recent.map((s, i) => <SessionRow key={s.id} s={s} first={i === 0} onOpen={onOpen} />)}
              {!recent.length ? empty('No sessions yet. Start one above.') : null}
            </div>
          </div>)}
        </div>
      </div>
    </div>
  );
}
