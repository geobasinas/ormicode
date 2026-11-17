import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EventQueue, NO_CAPABILITIES, RawLog, attachRawLog } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { PiCliMapper } from './map.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { model?: string; effort?: string; imageDir?: string; pendingImages?: string[];  spec: StartSpec; log?: RawLog; nativeId?: string; generatedId: boolean; queue: EventQueue; active: boolean; disposed: boolean; needsRecovery: boolean; process?: ChildProcessWithoutNullStreams; running?: Promise<void>; interrupted: boolean };
const execFileAsync = promisify(execFile);
const limit = 1024 * 1024;
const efforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

/** One `pi --mode json` process per prompt. New sessions get a generated `--session-id` so later turns resume with `--session`. */
export class PiCliAdapter implements AgentAdapter {
  readonly id = 'pi';
  readonly transport = 'cli' as const;
  readonly capabilities = { ...NO_CAPABILITIES, resume: true, model: true, effort: true, images: true };
  private sessions = new Map<Handle, Session>();
  private options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'pi', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'pi CLI not found or version check failed' }; }
  }
  async models() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'pi', ['--list-models'], { timeout: 15_000, windowsHide: true });
      return stdout.split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(columns => columns.length >= 6 && columns[0] && columns[1])
        .map(columns => ({ id: `${columns[0]}/${columns[1]}`, ...(columns[4] === 'yes' ? { efforts: efforts } : {}) }));
    } catch { return []; }
  }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create({ ...ref }, ref.id);
  }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode) throw new Error('pi CLI modes are not supported');
    if (spec.effort && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(spec.effort)) throw new Error('Unsupported pi thinking level');
    const handle = Object.freeze({ id: `pi-cli-${randomUUID()}` });
    this.sessions.set(handle, { model: spec.model, effort: spec.effort, spec: { ...spec }, log: spec.logDir ? new RawLog(spec.logDir) : undefined, nativeId: nativeId ?? randomUUID(), generatedId: !nativeId, queue: new EventQueue(), active: false, disposed: false, needsRecovery: false, interrupted: false });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('pi session requires explicit recovery');
    if (session.active) throw new Error('pi session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    if (input.images?.length) {
      session.imageDir ??= mkdtempSync(join(tmpdir(), 'ormi-pi-'));
      session.pendingImages = input.images.map((image, index) => {
        const path = join(session.imageDir as string, `img${index}${MIME_EXT[image.mimeType] ?? '.img'}`);
        writeFileSync(path, Buffer.from(image.data, 'base64'));
        return path;
      });
    }
    session.queue.push([{ kind: 'turn_start' }]); session.active = true; session.interrupted = false;
    session.running = this.run(handle, session, input.text);
  }
  private async run(handle: Handle, session: Session, text: string): Promise<void> {
    let child: ChildProcessWithoutNullStreams | undefined;
    let terminal = false; let aborted = false; let completed = false;
    const mapper = new PiCliMapper();
    try {
      if (session.disposed) return;
      if (session.interrupted) { session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]); return; }
      const args = ['--mode', 'json'];
      if (session.nativeId) args.push(session.generatedId ? '--session-id' : '--session', session.nativeId);
      if (session.model) args.push('--model', session.model);
      if (session.effort) args.push('--thinking', session.effort);
      const images = session.pendingImages ?? []; session.pendingImages = [];
      args.push('--', ...images.map(path => `@${path}`), text);
      child = (this.options.spawn ?? spawn)(this.options.executable ?? 'pi', args, { cwd: session.spec.cwd, windowsHide: true, shell: false });
      session.process = child; child.stdin.end();
      attachRawLog(child, session.log, this.options.executable ?? 'pi', session.spec.cwd);
      if (!session.log) child.stderr.resume();
      let spawnError: Error | undefined;
      const exit = new Promise<number | null>(resolve => { child!.once('error', error => { spawnError = error; }); child!.once('close', code => resolve(code)); });
      let buffer = Buffer.alloc(0);
      const accept = (line: Buffer) => {
        if (!line.length) return;
        const mapped = mapper.map(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        if (mapped.nativeId) {
          if (session.nativeId && mapped.nativeId !== session.nativeId) throw new Error('pi returned a different native session ID');
          session.nativeId = mapped.nativeId; this.options.onNativeId?.(handle, mapped.nativeId);
        }
        if (mapped.terminal) { terminal = true; aborted = mapped.aborted === true; }
        if (mapped.events.length) session.queue.push(mapped.events);
      };
      for await (const chunk of child.stdout) {
        session.log?.out(chunk);
        if (session.disposed) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
          if (line.length > limit) throw new Error('pi CLI line exceeds size limit');
          accept(line);
        }
        if (buffer.length > limit) throw new Error('pi CLI line exceeds size limit');
      }
      if (buffer.length && !session.disposed) accept(buffer);
      const exitCode = await exit;
      if (spawnError) throw spawnError;
      if (!session.disposed) {
        const trailing = mapper.finish();
        if (trailing.length) session.queue.push(trailing);
      }
      if (!session.disposed && !session.interrupted && !aborted && exitCode === 0 && terminal && session.nativeId) {
        completed = true;
      } else if (!session.disposed) {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: session.interrupted || aborted ? 'user_abort' : 'pi_cli_stream_ended' }]);
      }
    } catch (error) {
      child?.kill(); session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'pi CLI failed' }, { kind: 'interrupted', reason: 'pi_cli_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.process = undefined; session.active = false;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle); session.model = model;
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.get(handle);
    if (!efforts.includes(effort)) throw new Error('Unsupported pi thinking level');
    session.effort = effort;
    session.queue.push([{ kind: 'effort_changed', effort }]);
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('pi session has no active turn');
    session.interrupted = true; session.needsRecovery = true; session.process?.kill();
    await session.running;
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.process?.kill(); await session.running; session.queue.close(); this.sessions.delete(handle);
    if (session.imageDir) try { rmSync(session.imageDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed pi session');
    return session;
  }
}
