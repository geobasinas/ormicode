import { NO_CAPABILITIES } from './adapter.ts';
import type { AgentAdapter, Handle, PromptInput, StartSpec } from './adapter.ts';
import { EventQueue } from './event-queue.ts';

/** Deterministic test adapter. Sessions and transcripts exist only in memory. */
export class FakeAdapter implements AgentAdapter {
  readonly id = 'fake';
  readonly transport = 'cli' as const;
  readonly capabilities = NO_CAPABILITIES;
  private sessions = new Map<Handle, EventQueue>();
  private nextId = 0;

  async detect() { return { available: true, version: 'fake-1' }; }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> {
    if (!spec.cwd) throw new Error('cwd is required');
    const handle = Object.freeze({ id: `fake-${++this.nextId}` });
    this.sessions.set(handle, new EventQueue());
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    if (!input.text) throw new Error('prompt must not be empty');
    this.requireSession(handle).push([{ kind: 'turn_start' }, { kind: 'text', text: input.text }, { kind: 'turn_end' }]);
  }
  events(handle: Handle) { return this.requireSession(handle).subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle);
    if (!session) return;
    this.sessions.delete(handle);
    session.close();
  }
  private requireSession(handle: Handle): EventQueue {
    const session = this.sessions.get(handle);
    if (!session) throw new Error('unknown or disposed fake session');
    return session;
  }
}
