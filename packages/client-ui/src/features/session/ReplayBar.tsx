// Replay scrubber (README "Replay"): one bar under the transcript. The
// transcript filters to seq <= `at`; the daemon's replayFrame folds the
// session state at that point. Read-only — continuing goes through
// checkpoint fork or restore.
import { useEffect, useRef, useState } from 'react';
import { X, GitFork, RotateCcw } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { compactTokens } from '../../lib/format.ts';

export interface ReplayInfo {
  lastSeq: number;
  chapters: { seq: number; kind: string; ts: number; label: string }[];
  gaps: { from: number; to: number }[];
  checkpoints: { id: string; seq: number; ts: number }[];
}
export interface ReplayFrame {
  seq: number; state?: string; model?: string; effort?: string; mode?: string;
  pending: { kind: string; tool?: string; since: number }[];
  running: { name: string; since: number }[];
  tokens: number;
}

export function useReplayInfo(session: string | undefined, active: boolean): ReplayInfo | undefined {
  const { transport } = usePlatform();
  const [info, setInfo] = useState<ReplayInfo>();
  useEffect(() => {
    if (!session || !active) return;
    let alive = true;
    void transport.request('session.replay', { session })
      .then(r => { if (alive && r.type === 'res') setInfo(r.body as unknown as ReplayInfo); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [transport, session, active]);
  return info;
}

export function useReplayFrame(session: string | undefined, at: number | undefined): ReplayFrame | undefined {
  const { transport } = usePlatform();
  const [frame, setFrame] = useState<ReplayFrame>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (session === undefined || at === undefined) { setFrame(undefined); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void transport.request('session.replayFrame', { session, seq: at })
        .then(r => { if (r.type === 'res') setFrame((r.body as unknown as { frame: ReplayFrame }).frame); })
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(timer.current);
  }, [transport, session, at]);
  return frame;
}

export function ReplayBar({ session, info, frame, at, onAt, onExit, onForked }: {
  session: string; info: ReplayInfo; frame: ReplayFrame | undefined; at: number;
  onAt: (seq: number) => void; onExit: () => void; onForked?: (child: string) => void;
}) {
  const { transport } = usePlatform();
  const [busy, setBusy] = useState(false);
  const max = Math.max(info.lastSeq, 1);
  const checkpoint = [...info.checkpoints].filter(c => c.seq <= at).at(-1);
  const tick = (seq: number) => `${(seq / max) * 100}%`;
  const restore = async (mode: 'files' | 'conversation') => {
    if (!checkpoint || busy) return;
    setBusy(true);
    try { await transport.request('checkpoint.restore', { session, id: checkpoint.id, mode }); onExit(); }
    catch { /* surface via events */ }
    finally { setBusy(false); }
  };
  const fork = async () => {
    if (!checkpoint || busy) return;
    setBusy(true);
    try {
      const r = await transport.request('checkpoint.fork', { session, id: checkpoint.id });
      if (r.type === 'res') onForked?.(String((r.body as { session?: string }).session ?? ''));
    } catch { /* surface via events */ }
    finally { setBusy(false); }
  };
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-panel)', padding: '6px 12px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-label)' }}>
        <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>Replay</span>
        <div style={{ position: 'relative', flex: 1, height: 22, display: 'flex', alignItems: 'center' }}>
          {info.chapters.map(c => (
            <span key={`${c.seq}-${c.kind}`} title={`${c.label} · seq ${c.seq}`}
              style={{ position: 'absolute', left: tick(c.seq), top: 2, width: 5, height: 5, borderRadius: '50%', background: 'var(--text-hint)', opacity: 0.7, pointerEvents: 'none' }} />
          ))}
          {info.gaps.map(g => (
            <span key={g.from} title={`unrecorded: seq ${g.from}–${g.to}`}
              style={{ position: 'absolute', left: tick(g.from), width: `${((g.to - g.from + 1) / max) * 100}%`, bottom: 2, height: 3, background: 'var(--accent-red)', opacity: 0.5, pointerEvents: 'none' }} />
          ))}
          <input type="range" min={0} max={max} step={1} value={at} onChange={e => onAt(Number(e.target.value))}
            aria-label="Replay position" style={{ width: '100%', accentColor: 'var(--accent-primary)' }} />
        </div>
        <span style={{ minWidth: 80, textAlign: 'right' }}>seq {at} / {info.lastSeq}</span>
        <button onClick={onExit} title="Back to live" style={{ background: 'none', border: 'none', color: 'var(--text-label)', cursor: 'pointer', padding: 2, display: 'flex' }}><X size={13} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
        {frame ? <>
          <span>{frame.state ?? '—'}</span>
          {frame.model ? <span>{frame.model}{frame.effort ? ` · ${frame.effort}` : ''}</span> : null}
          {frame.pending.length ? <span style={{ color: 'var(--accent-amber)' }}>{frame.pending.length} pending</span> : null}
          {frame.running.length ? <span>{frame.running.length} tool(s) running</span> : null}
          {frame.tokens ? <span>{compactTokens(frame.tokens)} tokens</span> : null}
        </> : <span>…</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {checkpoint ? <>
            <button disabled={busy} onClick={() => void restore('conversation')} title={`Restore conversation and files to ${checkpoint.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-label)', cursor: 'pointer', padding: '2px 8px', fontSize: 11 }}>
              <RotateCcw size={11} />Restore
            </button>
            <button disabled={busy} onClick={() => void fork()} title={`Fork a new session from ${checkpoint.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-label)', cursor: 'pointer', padding: '2px 8px', fontSize: 11 }}>
              <GitFork size={11} />Fork
            </button>
          </> : <span style={{ fontSize: 10.5 }}>no checkpoint at this point</span>}
        </span>
      </div>
    </div>
  );
}
