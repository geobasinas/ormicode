import type { Link } from './socket.ts';
import type { McpProof } from './mcp-auth.ts';

/** Subscribe before reading current state; replay alone cannot establish current activity. */
export async function waitFor(link: Pick<Link, 'request' | 'onFrame'>, session: string, until: string, timeoutMs: number, proof: McpProof, team = false): Promise<string> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const remaining = () => Math.max(1, deadline - Date.now());
  let live = false;
  let subscribed = false;
  let unsubscribed = false;
  let settled = false;
  let lastState: string | undefined;
  let finish!: (result: Record<string, unknown>) => void;
  let fail!: (error: unknown) => void;
  const completed = new Promise<Record<string, unknown>>((resolve, reject) => {
    finish = result => { if (!settled) { settled = true; resolve(result); } };
    fail = error => { if (!settled) { settled = true; reject(error); } };
  });
  const timer = setTimeout(() => finish({ timedOut: true, ...(lastState ? { state: lastState } : {}) }), Math.max(0, timeoutMs));
  const unsubscribe = () => {
    if (!subscribed || unsubscribed) return;
    unsubscribed = true;
    void link.request('session.unsubscribe', { session }, remaining(), proof).catch(() => undefined);
  };
  const readStatus = () => link.request(team ? 'team.status' : 'session.get', { session, ...(team ? { actor: proof.session } : {}) }, remaining(), proof);
  let checking: Promise<void> | undefined;
  let recheck = false;
  const checkState = (): Promise<void> => {
    if (settled) return Promise.resolve();
    if (checking) { recheck = true; return checking; }
    checking = Promise.resolve().then(async () => {
      do {
        recheck = false;
        const current = await readStatus();
        if (settled) return;
        if (recheck) continue;
        if (current.type === 'err') { finish({ error: current.code }); return; }
        const state = String((current.body as Record<string, unknown>).state);
        lastState = state;
        if (['done', 'failed', 'archived', 'interrupted'].includes(state)
          || (until === 'approval' ? ['awaiting_approval', 'awaiting_input'].includes(state) : state === 'idle' && (current.body as Record<string, unknown>).turnCompleted === true)) finish({ state });
      } while (recheck && !settled);
    }).finally(() => { checking = undefined; });
    return checking;
  };
  const previous = link.onFrame;
  link.onFrame = frame => {
    previous?.(frame);
    if (frame.type !== 'evt' || frame.session !== session) return;
    const body = frame.body as Record<string, unknown>;
    if (!live) return;
    if (['turn_end', 'done', 'error', 'state', 'interrupted', 'approval_request', 'team_approval_request', 'question_request'].includes(String(body.kind)))
      void checkState().catch(fail);
  };
  const setup = async () => {
    const res = await link.request('session.subscribe', { session }, remaining(), proof);
    if (res.type === 'err') { finish({ error: res.code }); return; }
    subscribed = true;
    if (settled) { unsubscribe(); return; }
    live = true;
    await checkState();
  };
  try {
    void setup().catch(fail);
    return JSON.stringify(await completed);
  } finally {
    clearTimeout(timer);
    live = false;
    link.onFrame = previous;
    unsubscribe();
  }
}
