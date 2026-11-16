import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { OpenCodeCliMapper } from './map.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { spec: StartSpec; nativeId?: string; queue: EventQueue; active: boolean; disposed: boolean; needsRecovery: boolean; process?: ChildProcessWithoutNullStreams; running?: Promise<void>; interrupted: boolean };
const execFileAsync = promisify(execFile);
const limit = 1024 * 1024;

/** One `opencode run` process per turn on a private standalone server. Headless permission requests cannot be answered. */
export class OpenCodeCliAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly transport = 'cli' as const;
  readonly capabilities = NO_CAPABILITIES;
  private sessions = new Map<Handle, Session>();
  private options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'opencode', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /\b(\d+\.\d+\.\d+)\b/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'OpenCode CLI not found or version check failed' }; }
  }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create({ cwd: ref.cwd }, ref.id);
  }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.effort) throw new Error('OpenCode CLI effort is not yet supported');
    const handle = Object.freeze({ id: `opencode-cli-${randomUUID()}` });
    this.sessions.set(handle, { spec: { ...spec }, nativeId, queue: new EventQueue(), active: false, disposed: false, needsRecovery: false, interrupted: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('OpenCode session requires explicit recovery');
    if (session.active) throw new Error('OpenCode session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]); session.active = true; session.interrupted = false;
    session.running = this.run(handle, session, input.text);
  }
  private async run(handle: Handle, session: Session, text: string): Promise<void> {
    let child: ChildProcessWithoutNullStreams | undefined;
    let stopReason: string | undefined; let terminalId: string | undefined; let completed = false;
    const mapper = new OpenCodeCliMapper();
    try {
      if (session.disposed) return;
      if (session.interrupted) { session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]); return; }
      const args = ['run', '--format', 'json', '--standalone'];
      if (session.nativeId) args.push('--session', session.nativeId);
      if (session.spec.model) args.push('--model', session.spec.model);
      if (session.spec.mode) args.push('--agent', session.spec.mode);
      args.push('--', text);
      child = (this.options.spawn ?? spawn)(this.options.executable ?? 'opencode', args, { cwd: session.spec.cwd, windowsHide: true, shell: false });
      session.process = child; child.stdin.end(); child.stderr.resume();
      let spawnError: Error | undefined;
      const exit = new Promise<number | null>(resolve => { child!.once('error', error => { spawnError = error; }); child!.once('close', code => resolve(code)); });
      let buffer = Buffer.alloc(0);
      const accept = (line: Buffer) => {
        if (!line.length) return;
        const mapped = mapper.map(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        if (mapped.nativeId) {
          if (session.nativeId && mapped.nativeId !== session.nativeId) throw new Error('OpenCode returned a different native session ID');
          terminalId = mapped.nativeId;
        }
        if (mapped.stopReason) stopReason = mapped.stopReason;
        if (mapped.events.length) session.queue.push(mapped.events);
      };
      for await (const chunk of child.stdout) {
        if (session.disposed) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
          if (line.length > limit) throw new Error('OpenCode CLI line exceeds size limit');
          accept(line);
        }
        if (buffer.length > limit) throw new Error('OpenCode CLI line exceeds size limit');
      }
      if (buffer.length && !session.disposed) accept(buffer);
      const exitCode = await exit;
      if (spawnError) throw spawnError;
      if (!session.disposed) {
        const trailing = mapper.finish();
        if (trailing.length) session.queue.push(trailing);
      }
      if (!session.disposed && !session.interrupted && exitCode === 0 && (stopReason === 'stop' || stopReason === 'end_turn') && terminalId) {
        this.options.onNativeId?.(handle, terminalId); session.nativeId = terminalId; completed = true;
      } else if (!session.disposed) {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: session.interrupted ? 'user_abort' : `opencode_cli_${stopReason ?? 'stream_ended'}` }]);
      }
    } catch (error) {
      child?.kill(); session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'OpenCode CLI failed' }, { kind: 'interrupted', reason: 'opencode_cli_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.process = undefined; session.active = false;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('OpenCode session has no active turn');
    session.interrupted = true; session.needsRecovery = true; session.process?.kill();
    await session.running;
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.process?.kill(); await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed OpenCode session');
    return session;
  }
}
