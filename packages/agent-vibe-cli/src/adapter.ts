import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { EventQueue, NO_CAPABILITIES, RawLog, attachRawLog } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { VibeCliMapper } from './map.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { spec: StartSpec; model?: string; mode?: string; nativeId?: string; queue: EventQueue; log?: RawLog; active: boolean; disposed: boolean; needsRecovery: boolean; process?: ChildProcessWithoutNullStreams; running?: Promise<void>; interrupted: boolean };
const execFileAsync = promisify(execFile);
const limit = 1024 * 1024;
// Builtin --agent values documented by `vibe --help`.
const VIBE_BUILTIN_AGENTS = [
  { id: 'ask', name: 'ask' },
  { id: 'accept-edits', name: 'accept-edits' },
  { id: 'smart-approve', name: 'smart-approve' },
  { id: 'auto-approve', name: 'auto-approve' },
];

/** One `vibe --output streaming` process per turn. Headless runs deny approval-needing calls, so approvals are not forwarded. */
export class VibeCliAdapter implements AgentAdapter {
  readonly id = 'vibe';
  readonly transport = 'cli' as const;
  readonly capabilities = { ...NO_CAPABILITIES, resume: true, model: true, modes: true };
  private sessions = new Map<Handle, Session>();
  private options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'vibe', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'Vibe CLI not found or version check failed' }; }
  }
  async models() {
    // Vibe model ids are user aliases declared in the models table of config.toml.
    try {
      const config = readFileSync(join(process.env.VIBE_HOME ?? join(homedir(), '.vibe'), 'config.toml'), 'utf8');
      const block = /\bmodels\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
      return [...block.matchAll(/\balias\s*=\s*"([^"]+)"/g)].map(match => ({ id: match[1]! }));
    } catch { return []; }
  }
  /** `--agent` accepts the builtin agents plus customs from .vibe/agents/*.toml — each carries its own approval behavior. */
  modes(handle: Handle) {
    const cwd = this.get(handle).spec.cwd;
    const vibeHome = process.env.VIBE_HOME ?? join(homedir(), '.vibe');
    const dirs = [join(cwd, '.vibe', 'agents'), join(vibeHome, 'agents')];
    const custom = dirs.flatMap(dir => {
      try { return readdirSync(dir).filter(file => file.endsWith('.toml')).map(file => ({ id: file.slice(0, -5), name: file.slice(0, -5) })); }
      catch { return []; }
    });
    const seen = new Set<string>();
    return [...custom, ...VIBE_BUILTIN_AGENTS].filter(agent => !seen.has(agent.id) && seen.add(agent.id));
  }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create({ ...ref }, ref.id);
  }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.effort) throw new Error('Vibe CLI effort is not supported');
    const handle = Object.freeze({ id: `vibe-cli-${randomUUID()}` });
    this.sessions.set(handle, { spec: { ...spec }, nativeId, model: spec.model, mode: spec.mode, log: spec.logDir ? new RawLog(spec.logDir) : undefined, queue: new EventQueue(), active: false, disposed: false, needsRecovery: false, interrupted: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('Vibe session requires explicit recovery');
    if (session.active) throw new Error('Vibe session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]); session.active = true; session.interrupted = false;
    session.running = this.run(handle, session, input.text);
  }
  private async run(handle: Handle, session: Session, text: string): Promise<void> {
    let directory: string | undefined; let promptFile: string | undefined; let child: ChildProcessWithoutNullStreams | undefined;
    let terminalId: string | undefined; let terminal = false; let failed = false; let completed = false;
    const mapper = new VibeCliMapper();
    try {
      directory = await mkdtemp(join(tmpdir(), 'ormicode-vibe-'));
      promptFile = join(directory, 'prompt.txt');
      await writeFile(promptFile, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (session.disposed) return;
      if (session.interrupted) { session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]); return; }
      const args = ['--prompt-file', promptFile, '--output', 'streaming'];
      if (session.nativeId) args.push('--resume', session.nativeId);
      else {
        if (session.model) args.push('--model', session.model);
        if (session.mode) args.push('--agent', session.mode);
      }
      child = (this.options.spawn ?? spawn)(this.options.executable ?? 'vibe', args, { cwd: session.spec.cwd, windowsHide: true, shell: false });
      session.process = child; child.stdin.end();
      attachRawLog(child, session.log, this.options.executable ?? 'vibe', session.spec.cwd);
      if (!session.log) child.stderr.resume();
      let spawnError: Error | undefined;
      const exit = new Promise<number | null>(resolve => { child!.once('error', error => { spawnError = error; }); child!.once('close', code => resolve(code)); });
      let buffer = Buffer.alloc(0);
      const accept = (line: Buffer) => {
        if (!line.length) return;
        const mapped = mapper.map(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        if (mapped.nativeId) {
          if (session.nativeId && mapped.nativeId !== session.nativeId) throw new Error('Vibe returned a different native session ID');
          terminalId = mapped.nativeId;
        }
        if (mapped.terminal) { terminal = true; failed = mapped.failed === true; }
        if (mapped.events.length) session.queue.push(mapped.events);
      };
      for await (const chunk of child.stdout) {
        session.log?.out(chunk);
        if (session.disposed) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
          if (line.length > limit) throw new Error('Vibe CLI line exceeds size limit');
          accept(line);
        }
        if (buffer.length > limit) throw new Error('Vibe CLI line exceeds size limit');
      }
      if (buffer.length && !session.disposed) accept(buffer);
      const exitCode = await exit;
      if (spawnError) throw spawnError;
      if (!session.disposed) {
        const trailing = mapper.finish();
        if (trailing.length) session.queue.push(trailing);
      }
      if (!session.disposed && !session.interrupted && !failed && !mapper.failedGeneration && exitCode === 0 && terminalId && (terminal || mapper.completedEntry)) {
        this.options.onNativeId?.(handle, terminalId); session.nativeId = terminalId; completed = true;
      } else if (!session.disposed) {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: session.interrupted ? 'user_abort' : `vibe_cli_${failed ? 'error' : 'stream_ended'}` }]);
      }
    } catch (error) {
      child?.kill(); session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'Vibe CLI failed' }, { kind: 'interrupted', reason: 'vibe_cli_error' }]); }
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
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle); session.model = model;
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  async setMode(handle: Handle, mode: string): Promise<void> {
    const session = this.get(handle); session.mode = mode;
    session.queue.push([{ kind: 'mode_changed', mode }]);
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('Vibe session has no active turn');
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
    if (!session || session.disposed) throw new Error('Unknown or disposed Vibe session');
    return session;
  }
}
