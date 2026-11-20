import type { Link } from './socket.ts';
import type { McpProof } from './mcp-auth.ts';

/** Subscribe before reading current state; replay alone cannot establish current activity. */
export async function waitFor(link: Pick<Link, 'request' | 'onFrame'>, session: string, until: string, timeoutMs: number, proof: McpProof): Promise<string> {
  let live = false;
  let subscribed = false;
  let timer: NodeJS.Timeout | undefined;
  let finish!: (result: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const previous = link.onFrame;
  link.onFrame = frame => {
    previous?.(frame);
    if (!live || frame.type !== 'evt' || frame.session !== session) return;
    const body = frame.body as Record<string, unknown>;
    if (until === 'approval' && ['approval_request', 'team_approval_request', 'question_request'].includes(String(body.kind))) finish({ state: 'awaiting_approval' });
    if (body.kind === 'turn_end' && until !== 'approval') finish({ state: until === 'done' ? 'done' : 'idle' });
    if (body.kind === 'done') finish({ state: 'done' });
    if (body.kind === 'error') finish({ state: `error:${String(body.code ?? 'unknown')}` });
  };
  try {
    const res = await link.request('session.subscribe', { session }, 30_000, proof);
    if (res.type === 'err') return JSON.stringify({ error: res.code });
    subscribed = true;
    live = true;
    const current = await link.request('session.get', { session }, 30_000, proof);
    if (current.type === 'err') return JSON.stringify({ error: current.code });
    const state = String((current.body as Record<string, unknown>).state);
    if (['done', 'failed', 'archived', 'interrupted'].includes(state)
      || (until === 'approval' ? ['awaiting_approval', 'awaiting_input'].includes(state) : state === 'idle')) finish({ state });
    timer = setTimeout(() => { finish({ timedOut: true }); }, timeoutMs);
    const result = await completed;
    if (result.timedOut) {
      const latest = await link.request('session.get', { session }, 30_000, proof).catch(() => undefined);
      result.state = latest?.type === 'res' ? (latest.body as Record<string, unknown>).state : undefined;
    }
    return JSON.stringify(result);
  } finally {
    clearTimeout(timer);
    live = false;
    link.onFrame = previous;
    if (subscribed) await link.request('session.unsubscribe', { session }, 30_000, proof).catch(() => undefined);
  }
}
