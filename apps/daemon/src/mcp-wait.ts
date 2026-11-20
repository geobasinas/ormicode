import type { Link } from './socket.ts';
import type { McpProof } from './mcp-auth.ts';

/** Subscribe before reading current state; replay alone cannot establish current activity. */
export async function waitFor(link: Pick<Link, 'request' | 'onFrame'>, session: string, until: string, timeoutMs: number, proof: McpProof, team = false): Promise<string> {
  let live = false;
  let subscribed = false;
  let pendingTurn = false;
  let completedTurn = false;
  let timer: NodeJS.Timeout | undefined;
  let finish!: (result: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const readStatus = () => link.request(team ? 'team.status' : 'session.get', { session, ...(team ? { actor: proof.session } : {}) }, 30_000, proof);
  let checking: Promise<void> | undefined;
  let recheck = false;
  const checkState = (): Promise<void> => {
    if (checking) { recheck = true; return checking; }
    checking = Promise.resolve().then(async () => {
      do {
        recheck = false;
        const current = await readStatus();
        if (recheck) continue;
        if (current.type === 'err') { finish({ error: current.code }); return; }
        const state = String((current.body as Record<string, unknown>).state);
        if (['done', 'failed', 'archived', 'interrupted'].includes(state)
          || (until === 'approval' ? ['awaiting_approval', 'awaiting_input'].includes(state) : state === 'idle' && completedTurn && !pendingTurn)) finish({ state });
      } while (recheck);
    }).finally(() => { checking = undefined; });
    return checking;
  };
  const previous = link.onFrame;
  link.onFrame = frame => {
    previous?.(frame);
    if (frame.type !== 'evt' || frame.session !== session) return;
    const body = frame.body as Record<string, unknown>;
    if (body.kind === 'turn_start' || body.kind === 'state' && body.reason === 'prompt_dispatch') pendingTurn = true;
    if (body.kind === 'turn_end') { pendingTurn = false; completedTurn = true; }
    if (!live) return;
    if (['turn_end', 'done', 'error', 'state', 'interrupted', 'approval_request', 'team_approval_request', 'question_request'].includes(String(body.kind)))
      void checkState().catch(error => finish({ error: String(error) }));
  };
  try {
    const res = await link.request('session.subscribe', { session }, 30_000, proof);
    if (res.type === 'err') return JSON.stringify({ error: res.code });
    subscribed = true;
    live = true;
    await checkState();
    timer = setTimeout(() => { finish({ timedOut: true }); }, timeoutMs);
    const result = await completed;
    if (result.timedOut) {
      const latest = await readStatus().catch(() => undefined);
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
