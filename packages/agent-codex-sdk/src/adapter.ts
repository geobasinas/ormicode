import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { CodexEventMapper } from './map.ts';

interface CodexClient { startThread(options?: ThreadOptions): Thread; resumeThread(id: string, options?: ThreadOptions): Thread }
interface Session { thread: Thread; queue: EventQueue; nativeId?: string; active: boolean; disposed: boolean; interrupted: boolean; abort?: AbortController; running?: Promise<void> }

/** SDK runs through codex exec. No approval forwarding or mid-turn steering is exposed. */
export class CodexSdkAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly transport = 'sdk' as const;
  readonly capabilities = NO_CAPABILITIES;
  private readonly sessions = new Map<Handle, Session>();
  private readonly client: CodexClient;
  private readonly onNativeId?: (handle: Handle, id: string) => void;
  private serial = 0;
  constructor(options: { client?: CodexClient; onNativeId?: (handle: Handle, id: string) => void } = {}) {
    this.client = options.client ?? new Codex();
    this.onNativeId = options.onNativeId;
  }
  async detect() { return { available: true, reason: 'SDK package loaded; executable and authentication not checked' }; }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native thread ID is required');
    return this.create({ cwd: ref.cwd }, ref.id);
  }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode && spec.mode !== 'read-only' && spec.mode !== 'workspace-write') throw new Error('Unsupported or unsafe sandbox mode');
    if (spec.effort && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'].includes(spec.effort)) throw new Error('Unsupported Codex effort');
    // Sessions are not guaranteed a git checkout (bot jobs, no project folder), and
    // Ormicode owns the sandbox boundary anyway — codex's git-trust check must not gate start.
    const options: ThreadOptions = { workingDirectory: spec.cwd, approvalPolicy: 'never', sandboxMode: spec.mode as ThreadOptions['sandboxMode'] ?? 'read-only', skipGitRepoCheck: true, ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { modelReasoningEffort: spec.effort as ThreadOptions['modelReasoningEffort'] } : {}) };
    const thread = nativeId ? this.client.resumeThread(nativeId, options) : this.client.startThread(options);
    const handle = Object.freeze({ id: `codex-sdk-${++this.serial}` });
    this.sessions.set(handle, { thread, nativeId, queue: new EventQueue(), active: false, disposed: false, interrupted: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Codex session already has an active turn');
    if (session.interrupted) throw new Error('Codex session requires explicit recovery');
    if (!input.text) throw new Error('prompt must not be empty');
    session.active = true;
    const abort = new AbortController(); session.abort = abort;
    session.running = this.run(handle, session, input.text, abort);
  }
  private async run(handle: Handle, session: Session, text: string, abort: AbortController): Promise<void> {
    let terminal = false; let started = false;
    try {
      const { events } = await session.thread.runStreamed(text, { signal: abort.signal });
      const mapper = new CodexEventMapper();
      for await (const event of events) {
        if (session.disposed || abort.signal.aborted) break;
        const mapped = mapper.map(event);
        if (mapped.nativeId) {
          if (session.nativeId && session.nativeId !== mapped.nativeId) throw new Error('Codex returned a different native thread ID');
          this.onNativeId?.(handle, mapped.nativeId); session.nativeId = mapped.nativeId;
        }
        if (event.type === 'turn.started') started = true;
        if (mapped.terminal) terminal = true;
        if (mapped.events.length) session.queue.push(mapped.events);
        if (event.type === 'error') break;
      }
      if (!terminal && !session.disposed) {
        session.interrupted = true;
        session.queue.push([{ kind: 'interrupted', reason: abort.signal.aborted ? 'user_abort' : 'sdk_stream_ended' }]);
      }
      if (terminal && (!started || !session.nativeId)) throw new Error('Codex turn ended without a start or native thread ID');
    } catch (error) {
      terminal = false; session.interrupted = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'interrupted', reason: abort.signal.aborted ? 'user_abort' : 'sdk_error' }, ...(abort.signal.aborted ? [] : [{ kind: 'error' as const, code: 'unknown', message: error instanceof Error ? error.message : 'Codex SDK failed' }])]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.active = false; session.abort = undefined;
      if (terminal && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active || !session.abort) throw new Error('Codex session has no active turn');
    session.abort.abort(); await session.running;
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.abort?.abort(); await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed Codex session');
    return session;
  }
}
