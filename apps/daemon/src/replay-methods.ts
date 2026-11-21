// Replay (README "Replay"): rebuild what a session looked like at any seq.
// Frames are folded from journal events; `replay_frames` stores a snapshot
// every 50 events or at each turn end so seeking stays cheap. Read-only —
// continuing from a point goes through checkpoint fork/restore.
import { getSession, type Store } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import type { Client, DispatchCtx } from './dispatch.ts';
import { stateFor } from './supervisor-state.ts';

const FRAME_EVERY = 50;

export interface PendingItem { request: string; kind: 'approval' | 'question'; tool?: string; input?: unknown; options?: unknown; since: number }
export interface RunningCall { callId: string; name: string; input?: unknown; since: number }
export interface ReplayFrame {
  seq: number; state?: string; reason?: string; model?: string; effort?: string; mode?: string;
  pending: PendingItem[]; running: RunningCall[]; tokens: number;
}

interface RawEvent { seq: number; ts: number; kind: string; payload: Record<string, unknown> }

/** Fold events into the session's visible state at `seq`. */
export function fold(events: RawEvent[], upto: number, base?: ReplayFrame): ReplayFrame {
  const frame: ReplayFrame = base
    ? { ...base, seq: base.seq, pending: [...base.pending], running: [...base.running] }
    : { seq: 0, pending: [], running: [], tokens: 0 };
  for (const e of events) {
    if (e.seq > upto) break;
    if (e.seq <= frame.seq) continue;
    frame.seq = e.seq;
    const p = e.payload;
    if (e.kind === 'state' && typeof p.state === 'string') {
      frame.state = String(p.state);
      frame.reason = typeof p.reason === 'string' ? p.reason : undefined;
    } else {
      const mapped = stateFor[e.kind];
      if (mapped) { frame.state = mapped; frame.reason = typeof p.reason === 'string' ? p.reason : undefined; }
    }
    if (e.kind === 'model_changed') frame.model = String(p.model ?? frame.model ?? '');
    else if (e.kind === 'effort_changed') frame.effort = String(p.effort ?? frame.effort ?? '');
    else if (e.kind === 'mode_changed') frame.mode = String(p.mode ?? frame.mode ?? '');
    else if (e.kind === 'approval_request' || e.kind === 'question_request') {
      frame.pending.push({ request: String(p.request), kind: e.kind === 'approval_request' ? 'approval' : 'question', tool: p.tool as string | undefined, input: p.input, options: p.options, since: e.ts });
    } else if (e.kind === 'approval_decision' || e.kind === 'question_answer' || e.kind === 'interaction_expired') {
      frame.pending = frame.pending.filter(x => x.request !== String(p.request));
    } else if (e.kind === 'tool_call') {
      frame.running.push({ callId: String(p.callId), name: String(p.name), input: p.input, since: e.ts });
    } else if (e.kind === 'tool_result') {
      frame.running = frame.running.filter(x => x.callId !== String(p.callId));
    } else if (e.kind === 'usage') {
      frame.tokens += (Number(p.input) || 0) + (Number(p.output) || 0);
    }
  }
  return frame;
}

/** Latest stored frame at-or-before `seq`, if any. */
function storedFrame(db: Store, session: string, seq: number): ReplayFrame | undefined {
  const row = db.prepare('SELECT upto_seq, frame FROM replay_frames WHERE session = ? AND upto_seq <= ? ORDER BY upto_seq DESC LIMIT 1')
    .get(session, seq) as { upto_seq: number; frame: string } | undefined;
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.frame) as ReplayFrame;
    return { ...parsed, seq: row.upto_seq };
  } catch { return undefined; }
}

const CHAPTER_KINDS: Record<string, string> = {
  turn_start: 'Turn', approval_request: 'Approval', question_request: 'Question',
  error: 'Error', interrupted: 'Interrupted', compacted: 'Compacted',
  rate_limited: 'Rate limited', retry_scheduled: 'Retry', resumed: 'Resumed',
};

function chaptersOf(events: RawEvent[]): { seq: number; kind: string; ts: number; label: string }[] {
  const names = new Map<string, string>();
  const out: { seq: number; kind: string; ts: number; label: string }[] = [];
  for (const e of events) {
    if (e.kind === 'tool_call') names.set(String(e.payload.callId), String(e.payload.name));
    if (e.kind === 'tool_result' && e.payload.status === 'failed')
      out.push({ seq: e.seq, kind: 'tool_failed', ts: e.ts, label: `${names.get(String(e.payload.callId)) ?? 'tool'} failed` });
    const label = CHAPTER_KINDS[e.kind];
    if (label) out.push({ seq: e.seq, kind: e.kind, ts: e.ts, label });
  }
  return out;
}

/** Seq ranges with no events — cleaned-up chunks show as `unrecorded`. */
function gapsOf(events: RawEvent[]): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!.seq, cur = events[i]!.seq;
    if (cur - prev > 1) gaps.push({ from: prev + 1, to: cur - 1 });
  }
  return gaps;
}

export async function replayMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  const events = replay(ctx.db, session).map(e => ({ seq: e.seq, ts: e.ts, kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown> }));

  if (method === 'session.replay') {
    const checkpoints = await ctx.checkpoints.repo(session).list();
    return client.link.reply(id, {
      session, lastSeq: events.at(-1)?.seq ?? 0,
      chapters: chaptersOf(events), gaps: gapsOf(events),
      checkpoints: checkpoints.map(c => ({ id: c.id, seq: c.seq, ts: c.ts })),
    });
  }

  if (method === 'session.replayFrame') {
    const seq = Math.max(0, Math.floor(Number(body.seq) || 0));
    const base = storedFrame(ctx.db, session, seq);
    const frame = fold(events, seq, base);
    // Snapshot at boundaries: every 50 events or right after a turn ends,
    // whichever comes first.
    const upsert = ctx.db.prepare('INSERT OR REPLACE INTO replay_frames(session, upto_seq, frame) VALUES (?, ?, ?)');
    const candidates = events.filter(e => e.seq > (base?.seq ?? 0) && e.seq <= seq && (e.seq % FRAME_EVERY === 0 || e.kind === 'turn_end'));
    for (const boundary of candidates) upsert.run(session, boundary.seq, JSON.stringify(fold(events, boundary.seq, base)));
    return client.link.reply(id, { session, seq: frame.seq, frame });
  }

  if (method === 'session.replayExport') {
    const fromSeq = Math.max(0, Math.floor(Number(body.fromSeq) || 0));
    const toSeq = body.toSeq === undefined ? Number.MAX_SAFE_INTEGER : Math.floor(Number(body.toSeq));
    const slice = events.filter(e => e.seq >= fromSeq && e.seq <= toSeq);
    const checkpoints = await ctx.checkpoints.repo(session).list();
    return client.link.reply(id, {
      bundle: {
        version: 1, session, exportedAt: Date.now(), fromSeq, toSeq,
        events: slice,
        checkpoints: checkpoints.filter(c => c.seq >= fromSeq && c.seq <= toSeq).map(c => ({ id: c.id, seq: c.seq, ts: c.ts, tool: c.tool })),
        gaps: gapsOf(slice),
      },
    });
  }

  return client.link.replyError(id, 'protocol.unimplemented', method);
}
