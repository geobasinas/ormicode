import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { EventQueue, NO_CAPABILITIES, RawLog, attachRawLog } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { GrokCliMapper } from './map.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { spec: StartSpec; log?: RawLog; nativeId?: string; queue: EventQueue; active: boolean; disposed: boolean; needsRecovery: boolean; process?: ChildProcessWithoutNullStreams; running?: Promise<void>; interrupted: boolean };
const execFileAsync = promisify(execFile);
const limit = 1024 * 1024;

/** One headless Grok process per turn. Headless permission requests are not interactive. */
export class GrokCliAdapter implements AgentAdapter {
  readonly id = 'grok';
  readonly transport = 'cli' as const;
  readonly capabilities = { ...NO_CAPABILITIES, resume: true };
  private sessions = new Map<Handle, Session>();
  private options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'grok', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'Grok CLI not found or version check failed' }; }
  }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create({ ...ref }, ref.id);
  }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode || spec.effort) throw new Error('Grok CLI modes and effort are not yet supported');
    const handle = Object.freeze({ id: `grok-cli-${randomUUID()}` });
    this.sessions.set(handle, { spec: { ...spec }, log: spec.logDir ? new RawLog(spec.logDir) : undefined, nativeId, queue: new EventQueue(), active: false, disposed: false, needsRecovery: false, interrupted: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('Grok session requires explicit recovery');
    if (session.active) throw new Error('Grok session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]); session.active = true; session.interrupted = false;
    session.running = this.run(handle, session, input.text);
  }
  private async run(handle: Handle, session: Session, text: string): Promise<void> {
    let directory: string | undefined; let promptFile: string | undefined; let child: ChildProcessWithoutNullStreams | undefined;
    let stopReason: string | undefined; let terminalId: string | undefined; let completed = false;
    try {
      directory = await mkdtemp(join(tmpdir(), 'ormicode-grok-'));
      promptFile = join(directory, 'prompt.txt');
      await writeFile(promptFile, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (session.disposed) return;
      if (session.interrupted) { session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]); return; }
      const args = ['--no-auto-update', '--permission-mode', 'dontAsk', '--output-format', 'streaming-json', '--prompt-file', promptFile];
      if (session.nativeId) args.push('--resume', session.nativeId);
      if (session.spec.model) args.push('--model', session.spec.model);
      child = (this.options.spawn ?? spawn)(this.options.executable ?? 'grok', args, { cwd: session.spec.cwd, windowsHide: true, shell: false });
      session.process = child; child.stdin.end();
      attachRawLog(child, session.log, this.options.executable ?? 'grok', session.spec.cwd);
      if (!session.log) child.stderr.resume();
      let spawnError: Error | undefined;
      const exit = new Promise<number | null>(resolve => { child!.once('error', error => { spawnError = error; }); child!.once('close', code => resolve(code)); });
      const mapper = new GrokCliMapper(); let buffer = Buffer.alloc(0);
      const accept = (line: Buffer) => {
        if (!line.length) return;
        const mapped = mapper.map(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        if (mapped.nativeId) {
          if (session.nativeId && mapped.nativeId !== session.nativeId) throw new Error('Grok returned a different native session ID');
          terminalId = mapped.nativeId;
        }
        if (mapped.stopReason) stopReason = mapped.stopReason;
        if (mapped.events.length) session.queue.push(mapped.events);
      };
      for await (const chunk of child.stdout) {
        session.log?.out(chunk);
        if (session.disposed) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
          if (line.length > limit) throw new Error('Grok CLI line exceeds size limit');
          accept(line);
        }
        if (buffer.length > limit) throw new Error('Grok CLI line exceeds size limit');
      }
      if (buffer.length && !session.disposed) accept(buffer);
      const exitCode = await exit;
      if (spawnError) throw spawnError;
      if (!session.disposed && !session.interrupted && exitCode === 0 && stopReason === 'end_turn' && terminalId) {
        this.options.onNativeId?.(handle, terminalId); session.nativeId = terminalId; completed = true;
      } else if (!session.disposed) {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: session.interrupted ? 'user_abort' : `grok_cli_${stopReason ?? 'stream_ended'}` }]);
      }
    } catch (error) {
      child?.kill(); session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'Grok CLI failed' }, { kind: 'interrupted', reason: 'grok_cli_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      let cleanupFailed = false;
      if (promptFile) await unlink(promptFile).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') cleanupFailed = true; });
      if (directory) await rmdir(directory).catch(() => { cleanupFailed = true; });
      if (cleanupFailed && !session.disposed) {
        completed = false; session.needsRecovery = true;
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: 'Could not remove the temporary prompt file' }, { kind: 'interrupted', reason: 'prompt_cleanup_failed' }]); } catch { session.queue.close(); }
      }
      session.process = undefined; session.active = false;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('Grok session has no active turn');
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
    if (!session || session.disposed) throw new Error('Unknown or disposed Grok session');
    return session;
  }
}
