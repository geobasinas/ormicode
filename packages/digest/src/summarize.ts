// Mechanical re-entry digest: every field is pulled straight from journal
// events since `since` — nothing is claimed that isn't in an event.
export interface DigestEvent { seq: number; ts: number; kind: string; payload: Record<string, unknown> }
export interface DigestSession { id: string; state: string; updatedAt: number; reason?: string | null; delegatedApproval?: boolean }
export type Rank = 'waiting' | 'failed' | 'done' | 'progressed' | 'silent';
export interface Wants { kind: 'approval' | 'question' | 'rate_limit'; since: number }
export type DigestEntry =
  | { session: string; rank: Exclude<Rank, 'silent'>; source: 'mechanical'; changed: { paths: string[]; result?: string };
      wants: Wants | null; dropped: string[]; where: { state: string; ageMs: number }; cost: { tokens: number } }
  | { session: string; rank: 'silent'; source: 'mechanical'; silentMs: number };

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path'];
const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function summarize(s: DigestSession, events: DigestEvent[], since: number, now = Date.now()): DigestEntry {
  events = events.filter(e => e.kind !== 'terminal_open' && e.kind !== 'terminal_close');
  if (!events.length) return { session: s.id, rank: 'silent', source: 'mechanical', silentMs: Math.max(0, now - Math.max(since, s.updatedAt)) };
  const paths = new Set<string>(); const calls = new Map<string, string>(); const dropped: string[] = [];
  const open = new Map<string, Wants>();
  let result: string | undefined; let tokens = 0; let lastText: string | undefined;
  let userAborted = s.reason === 'user_abort';
  for (const e of events) {
    const p = e.payload;
    if (e.kind === 'turn_start' || e.kind === 'state' && p.reason === 'prompt_dispatch') userAborted = false;
    if (e.kind === 'interrupted') { userAborted = p.reason === 'user_abort'; if (userAborted) open.clear(); }
    if (e.kind === 'tool_call') {
      calls.set(String(p.callId), String(p.name));
      const input = p.input as Record<string, unknown> | null;
      for (const k of PATH_KEYS) if (input && typeof input[k] === 'string') paths.add(input[k] as string);
    } else if (e.kind === 'tool_result' && p.status === 'failed') {
      const name = calls.get(String(p.callId)) ?? 'tool';
      dropped.push(`${name} failed`);
      if (typeof p.output === 'string') result = clip(`${name}: ${p.output}`);
    } else if (e.kind === 'approval_request') open.set(String(p.request), { kind: 'approval', since: e.ts });
    else if (e.kind === 'question_request') open.set(String(p.request), { kind: 'question', since: e.ts });
    else if (e.kind === 'approval_decision' || e.kind === 'question_answer' || e.kind === 'interaction_expired' && !(p.answerable === true && open.get(String(p.request))?.kind === 'question')) open.delete(String(p.request));
    else if (e.kind === 'usage') tokens += Number(p.input ?? 0) + Number(p.output ?? 0);
    else if (e.kind === 'text' && typeof p.text === 'string') lastText = p.text;
  }
  let wants: Wants | null = [...open.values()].at(-1) ?? null;
  if (userAborted && s.state === 'interrupted') wants = null;
  if (!wants && s.state === 'paused_rate_limited') wants = { kind: 'rate_limit', since: s.updatedAt };
  const canWait = !['idle', 'interrupted', 'failed', 'done', 'archived', 'paused_rate_limited'].includes(s.state);
  const userRequest = wants?.kind === 'approval' || wants?.kind === 'question';
  const rank: Exclude<Rank, 'silent'> = canWait && (userRequest || !s.delegatedApproval && (s.state === 'awaiting_approval' || s.state === 'awaiting_input')) ? 'waiting'
    : s.state === 'failed' || s.state === 'interrupted' && !userAborted ? 'failed' : s.state === 'done' ? 'done' : 'progressed';
  if (!result && lastText) result = clip(lastText);
  return {
    session: s.id, rank, source: 'mechanical',
    changed: { paths: [...paths], ...(result ? { result } : {}) },
    wants, dropped, where: { state: s.state, ageMs: Math.max(0, now - s.updatedAt) }, cost: { tokens },
  };
}

const ORDER: Rank[] = ['waiting', 'failed', 'done', 'progressed', 'silent'];
/** waiting → failed/interrupted → done → progressed → silent; within a rank, longest blocked (oldest) first. */
export function rank(entries: DigestEntry[]): DigestEntry[] {
  const age = (e: DigestEntry) => (e.rank === 'silent' ? e.silentMs : e.wants ? -e.wants.since : e.where.ageMs);
  return [...entries].sort((a, b) => ORDER.indexOf(a.rank) - ORDER.indexOf(b.rank) || age(b) - age(a));
}
