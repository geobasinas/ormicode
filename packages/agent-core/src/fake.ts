import { NO_CAPABILITIES } from './adapter.ts';
import type { AgentAdapter, Handle, PromptInput, StartSpec } from './adapter.ts';
import { EventQueue } from './event-queue.ts';
import type { AgentEvent } from '@ormicode/protocol';

export type FakeScript = 'echo' | 'slow' | 'tool' | 'approval' | 'ratelimit' | 'ratelimit_pause';
type Session = {
  queue: EventQueue; spec: StartSpec; nativeId: string;
  script: FakeScript; delayMs: number;
  active: boolean; interrupted: boolean; hold?: () => void;
  approvalRequest?: string; approvalResolve?: (option: string) => void;
  pausedOnce?: boolean;
};

/** Deterministic test adapter. Sessions and transcripts exist only in memory. `echo` (default) answers instantly; the scripted modes hold turns open so tests can kill or interrupt mid-turn, mid-tool-call, or mid-approval. Script comes from `options.script` or `ORMICODE_FAKE_SCRIPT`. */
export class FakeAdapter implements AgentAdapter {
  readonly id = 'fake';
  readonly transport = 'cli' as const;
  readonly capabilities = NO_CAPABILITIES;
  private sessions = new Map<Handle, Session>();
  private nextId = 0;
  private readonly script?: FakeScript;
  private readonly delayMs: number;
  constructor(options: { script?: FakeScript; delayMs?: number } = {}) {
    const env = process.env.ORMICODE_FAKE_SCRIPT;
    this.script = options.script ?? (env === 'slow' || env === 'tool' || env === 'approval' || env === 'ratelimit' || env === 'ratelimit_pause' ? env : undefined);
    this.delayMs = options.delayMs ?? (Number(process.env.ORMICODE_FAKE_DELAY_MS) || 30_000);
  }
  async detect() { return { available: true, version: 'fake-1' }; }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> {
    if (!spec.cwd) throw new Error('cwd is required');
    const handle = Object.freeze({ id: `fake-${++this.nextId}` });
    this.sessions.set(handle, {
      queue: new EventQueue(), spec: { ...spec }, nativeId: `fake-native-${this.nextId}`,
      script: this.script ?? 'echo', delayMs: this.delayMs, active: false, interrupted: false,
    });
    return handle;
  }
  nativeId(handle: Handle): string { return this.requireSession(handle).nativeId; }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    if (!input.text) throw new Error('prompt must not be empty');
    const session = this.requireSession(handle);
    if (session.script === 'echo') {
      session.queue.push([{ kind: 'turn_start' }, { kind: 'text', text: input.text }, { kind: 'turn_end' }]);
      return;
    }
    if (session.active) throw new Error('fake session already has an active turn');
    session.active = true; session.interrupted = false;
    void this.run(session, input.text);
  }
  private hold(session: Session): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, session.delayMs);
      session.hold = () => { clearTimeout(timer); resolve(); };
    });
  }
  private endHold(session: Session): void { session.hold?.(); session.hold = undefined; }
  private async run(session: Session, text: string): Promise<void> {
    const events: AgentEvent[] = [{ kind: 'turn_start' }];
    try {
      if (session.script === 'slow') {
        session.queue.push([...events, { kind: 'text_delta', text: 'working…' }]);
        await this.hold(session);
        if (session.interrupted) throw interrupted();
        session.queue.push([{ kind: 'text', text }, { kind: 'turn_end' }]);
      } else if (session.script === 'tool') {
        session.queue.push([...events, { kind: 'tool_call', callId: 'call-1', name: 'fake_tool', input: { text } }]);
        await this.hold(session);
        if (session.interrupted) {
          session.queue.push([{ kind: 'tool_result', callId: 'call-1', status: 'interrupted' }, { kind: 'interrupted', reason: 'user_abort' }]);
        } else session.queue.push([{ kind: 'tool_result', callId: 'call-1', status: 'completed', output: 'done' }, { kind: 'text', text }, { kind: 'turn_end' }]);
      } else if (session.script === 'approval') {
        session.approvalRequest = `req_fake-${session.nativeId}`;
        session.queue.push([...events, { kind: 'tool_call', callId: 'call-1', name: 'fake_tool', input: { text } }, { kind: 'approval_request', request: session.approvalRequest, options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] }]);
        const option = await new Promise<string>(resolve => { session.approvalResolve = resolve; this.endHold(session); session.hold = () => resolve('deny'); });
        session.queue.push([{ kind: 'approval_decision', request: session.approvalRequest, option }, { kind: 'tool_result', callId: 'call-1', status: option === 'allow' ? 'completed' : 'interrupted' }, ...(session.interrupted || option === 'deny' ? [{ kind: 'interrupted', reason: 'user_abort' } satisfies AgentEvent] : [{ kind: 'turn_end' } satisfies AgentEvent])]);
      } else if (session.script === 'ratelimit_pause') {
        // First turn gives up after the retry budget: no turn_end, the session
        // suspends until the supervisor resends at resetAt. Later turns echo.
        if (session.pausedOnce) session.queue.push([...events, { kind: 'text', text }, { kind: 'turn_end' }]);
        else {
          session.pausedOnce = true;
          session.queue.push([...events, { kind: 'rate_limited', attempt: 5 },
            { kind: 'error', code: 'plan_limit', message: 'plan limit reached', resetAt: Date.now() + session.delayMs }]);
        }
      } else {
        session.queue.push([...events, { kind: 'rate_limited', attempt: 1 }, { kind: 'retry_scheduled', delayMs: 1000 }, { kind: 'text', text }, { kind: 'turn_end' }]);
      }
    } catch {
      try { session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]); } catch { /* queue may be closed */ }
    } finally {
      session.active = false; session.hold = undefined; session.approvalResolve = undefined;
    }
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> {
    const session = this.requireSession(handle);
    if (session.approvalRequest !== requestId || !session.approvalResolve) throw new Error('Unknown approval request');
    session.approvalResolve(optionId);
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.requireSession(handle);
    if (!session.active) throw new Error('fake session has no active turn');
    session.interrupted = true; this.endHold(session);
  }
  events(handle: Handle) { return this.requireSession(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle);
    if (!session) return;
    this.sessions.delete(handle);
    this.endHold(session); session.approvalResolve?.('deny');
    session.queue.close();
  }
  private requireSession(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session) throw new Error('unknown or disposed fake session');
    return session;
  }
}
function interrupted(): Error { return new Error('fake turn interrupted'); }
