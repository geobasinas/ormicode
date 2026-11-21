// Re-entry digest summaries (README "Re-entry digest"): the mechanical entry
// is always served synchronously; a background utility call then refines the
// prose, journaled as `digest_ready` so open clients refresh. Nothing blocks
// on the model call — failure silently keeps the mechanical text.
import { rank as rankDigest, summarize as digestOf, type DigestEntry } from '@ormicode/digest';
import { listSessions } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { sessionStatus } from './session-status.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function promptFor(since: number, entries: DigestEntry[]): string {
  const rows = entries.map(e => e.rank === 'silent' ? null : {
    session: e.session,
    state: e.where.state,
    changedPaths: e.changed.paths.slice(0, 20),
    mechanicalResult: clip(e.changed.result ?? '', 400),
    dropped: e.dropped.slice(0, 10),
  }).filter(Boolean);
  return [
    'Summarize each session for a developer returning to work. Return ONLY JSON:',
    '[{ "session": "<id>", "result": "<one or two sentences: what changed and the outcome>", "dropped": ["<what was tried and abandoned>"] }]',
    'Never claim anything not in the input. Keep `dropped` empty if nothing failed or was abandoned.',
    `Events since: ${new Date(since).toISOString()}`,
    JSON.stringify(rows),
  ].join('\n');
}

function parse(text: string, group: DigestEntry[]): { session: string; entry: DigestEntry }[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const byId = new Map(group.map(e => [e.session, e]));
  const out: { session: string; entry: DigestEntry }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || item.rank === 'silent') continue;
    const session = String((item as Record<string, unknown>).session ?? '');
    const mech = byId.get(session);
    if (!mech || mech.rank === 'silent') continue;
    const raw = item as Record<string, unknown>;
    const result = typeof raw.result === 'string' ? clip(raw.result, 400) : mech.changed.result;
    const dropped = Array.isArray(raw.dropped) ? raw.dropped.filter((d): d is string => typeof d === 'string').slice(0, 10) : mech.dropped;
    out.push({ session, entry: { ...mech, source: 'summary', changed: { ...mech.changed, ...(result ? { result } : {}) }, dropped } });
  }
  return out;
}

export async function digestSummarize(ctx: DispatchCtx, since: number, mechanical: DigestEntry[]): Promise<void> {
  const targets = mechanical.filter(e => e.rank !== 'silent' && e.rank !== 'done').slice(0, 20);
  if (!targets.length || ctx.utility.budgetLeft() <= 0) return;
  // Spec: one call per session; more than three changed sessions → one batched call.
  const groups = targets.length > 3 ? [targets] : targets.map(e => [e]);
  let produced = 0;
  for (const group of groups) {
    const out = await ctx.utility.call(promptFor(since, group));
    if (!out) break;
    for (const { session, entry } of parse(out.text, group)) {
      ctx.digestSummaries.set(session, { since, entry });
      ctx.record(session, 'digest_ready', { since, source: 'summary' });
      produced += 1;
    }
  }
  if (produced) ctx.sessionsChanged();
}

export function overlaySummaries(summaries: Map<string, { since: number; entry: DigestEntry }>, since: number, entries: DigestEntry[]): DigestEntry[] {
  return entries.map(e => {
    const s = summaries.get(e.session);
    return s && s.since === since ? s.entry : e;
  });
}

export { promptFor as digestPromptFor, parse as parseDigestSummary };

export function digestMethod(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): void {
  const { db } = ctx;
  const since = Number(body.since); const computedAt = Date.now();
  const mechanical = listSessions(db).map(s => digestOf({ id: s.id, state: sessionStatus(ctx, s).state, reason: s.reason, delegatedApproval: ctx.teamApprovals.delegatedOnly(s.id), updatedAt: s.updated_at },
    replay(db, s.id).filter(e => e.ts > since).map(e => ({ seq: e.seq, ts: e.ts, kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown> })),
    since, computedAt));
  // Mechanical entries are served now; utility summaries run in the
  // background and surface through the journaled digest_ready events.
  void digestSummarize(ctx, since, mechanical).catch(() => undefined);
  client.link.reply(id, { since, computedAt, entries: rankDigest(overlaySummaries(ctx.digestSummaries, since, mechanical)) });
}
