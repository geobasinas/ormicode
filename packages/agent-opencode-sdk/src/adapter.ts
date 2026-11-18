import { execFile } from 'node:child_process';
import type { SpawnOptionsWithoutStdio, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/mini';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, ModelList, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { OpenCodeServer, listOpenCodeModels } from './server.ts';
import { OpenCodeEventMapper } from './map.ts';
import { OpenCodePermissionBroker } from './permissions.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Finish = { resolve: (failed: string | undefined) => void; settled: boolean };
type Session = {
  sessionId: string; spec: StartSpec; queue: EventQueue; broker: OpenCodePermissionBroker;
  mapper: OpenCodeEventMapper; active: boolean; disposed: boolean; needsRecovery: boolean;
  interruptRequested: boolean; abort: AbortController; listening: Promise<void>;
  running?: Promise<void>; finish?: Finish; model?: string; effort?: string;
};
const execFileAsync = promisify(execFile);

/** OpenCode v2 SDK adapter over an owned loopback server. Permission decisions are forwarded without changing their scope. */
export class OpenCodeSdkAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly transport = 'sdk' as const;
  readonly capabilities = { ...NO_CAPABILITIES, approvals: true, steer: true, resume: true, model: true, effort: true, modes: true };
  private readonly sessions = new Map<Handle, Session>();
  private server?: OpenCodeServer;
  private starting?: Promise<OpenCodeServer>;
  private readonly options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'opencode', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'OpenCode CLI not found or version check failed' }; }
  }
  private ensureServer(): Promise<OpenCodeServer> {
    if (this.server) return Promise.resolve(this.server);
    this.starting ??= OpenCodeServer.start({ executable: this.options.executable, spawn: this.options.spawn })
      .then(server => { this.server = server; return server; })
      .finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async models(): Promise<ModelList> {
    return listOpenCodeModels(await this.ensureServer());
  }
  async start(spec: StartSpec): Promise<Handle> {
    if (!spec.cwd) throw new Error('cwd is required');
    const server = await this.ensureServer();
    const sessionId = await server.createSession(spec.cwd);
    const handle = this.attach(spec, sessionId);
    const session = this.sessions.get(handle)!;
    if (spec.effort) session.effort = spec.effort;
    if (spec.model) await this.setModel(handle, spec.model);
    if (spec.mode) await this.setMode(handle, spec.mode);
    return handle;
  }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id || !ref.cwd) throw new Error('native session ID and cwd are required');
    const server = await this.ensureServer();
    await server.getSession(ref.id);
    const handle = this.attach(ref, ref.id);
    if (ref.model) await this.setModel(handle, ref.model);
    if (ref.mode) await this.setMode(handle, ref.mode);
    return handle;
  }
  private attach(spec: StartSpec, sessionId: string): Handle {
    const server = this.server!;
    const handle = Object.freeze({ id: `opencode-sdk-${randomUUID()}` });
    const queue = new EventQueue();
    const abort = new AbortController();
    const session: Session = {
      sessionId, spec: { ...spec }, queue, mapper: new OpenCodeEventMapper(sessionId),
      broker: OpenCodePermissionBroker.create(event => queue.push([event]), server.client),
      active: false, disposed: false, needsRecovery: false, interruptRequested: false,
      abort, listening: Promise.resolve(),
      ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { effort: spec.effort } : {}),
    };
    session.listening = this.listen(session, server, abort.signal);
    this.sessions.set(handle, session);
    this.options.onNativeId?.(handle, sessionId);
    return handle;
  }
  private async listen(session: Session, server: OpenCodeServer, signal: AbortSignal): Promise<void> {
    try {
      for await (const event of server.client.event.subscribe({ signal })) {
        if (session.disposed) return;
        if (event.type === 'permission.asked') {
          const data = (event as { data?: { sessionID?: string } }).data;
          if (data?.sessionID === session.sessionId && session.active) session.broker.asked(data);
          continue;
        }
        if (event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
          const data = (event as { data?: { sessionID?: string } }).data;
          if (data?.sessionID !== session.sessionId) continue;
          const mapped = event.type === 'session.execution.failed' ? session.mapper.map(event) : [];
          if (mapped.length) session.queue.push(mapped);
          if (session.finish && !session.finish.settled) {
            session.finish.settled = true;
            session.finish.resolve(event.type === 'session.execution.succeeded' ? undefined : event.type);
          }
          continue;
        }
        if (session.active) {
          const mapped = session.mapper.map(event);
          if (mapped.length) session.queue.push(mapped);
        }
      }
    } catch { /* The subscription ends on abort or server shutdown; turn state resolves elsewhere. */ }
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('OpenCode session requires explicit recovery');
    if (session.active) throw new Error('OpenCode session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true; session.interruptRequested = false;
    session.mapper = new OpenCodeEventMapper(session.sessionId);
    session.running = this.turn(session, input.text, undefined);
  }
  async steer(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('OpenCode session has no active turn');
    if (!input.text) throw new Error('steer must not be empty');
    await this.server!.client.session.prompt({ sessionID: session.sessionId, text: input.text, delivery: 'steer' });
  }
  private async turn(session: Session, text: string, delivery: 'steer' | 'queue' | undefined): Promise<void> {
    let completed = false;
    const finish = new Promise<string | undefined>(resolve => { session.finish = { resolve, settled: false }; });
    try {
      await this.server!.client.session.prompt({ sessionID: session.sessionId, text, ...(delivery ? { delivery } : {}) });
      const failed = await finish;
      if (session.disposed) return;
      const trailing = session.mapper.finish();
      if (trailing.length) session.queue.push(trailing);
      if (failed === undefined) completed = true;
      else if (failed === 'session.execution.interrupted') {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: session.interruptRequested ? 'user_abort' : 'opencode_interrupted' }]);
      } else {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: 'opencode_failed' }]);
      }
    } catch (error) {
      session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'OpenCode SDK failed' }, { kind: 'interrupted', reason: 'opencode_sdk_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.broker.expireAll('turn_finished');
      session.active = false; session.finish = undefined;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('OpenCode session has no active turn');
    session.interruptRequested = true; session.broker.expireAll('cancelled');
    await this.server!.client.session.interrupt({ sessionID: session.sessionId });
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> { this.get(handle).broker.decide(requestId, optionId); }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('OpenCode session has an active turn');
    const slash = model.indexOf('/');
    if (slash < 1 || slash === model.length - 1) throw new Error('model must be provider/model');
    await this.server!.client.session.switchModel({ sessionID: session.sessionId, model: { providerID: model.slice(0, slash), id: model.slice(slash + 1), ...(session.effort ? { variant: session.effort } : {}) } });
    session.model = model;
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  /** Effort maps to an OpenCode model variant; it applies once a model is known. */
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('OpenCode session has an active turn');
    if (!effort) throw new Error('effort is required');
    session.effort = effort;
    if (session.model) {
      const slash = session.model.indexOf('/');
      await this.server!.client.session.switchModel({ sessionID: session.sessionId, model: { providerID: session.model.slice(0, slash), id: session.model.slice(slash + 1), variant: effort } });
    }
    session.queue.push([{ kind: 'effort_changed', effort }]);
  }
  async setMode(handle: Handle, mode: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('OpenCode session has an active turn');
    if (!mode) throw new Error('mode is required');
    await this.server!.client.session.switchAgent({ sessionID: session.sessionId, agent: mode });
    session.queue.push([{ kind: 'mode_changed', mode }]);
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.broker.expireAll('disposed'); session.abort.abort();
    try { await this.server?.client.session.interrupt({ sessionID: session.sessionId }); } catch { /* Server may already be down. */ }
    await session.running; await session.listening; session.queue.close(); this.sessions.delete(handle);
    if (!this.sessions.size) { this.server?.close(); this.server = undefined; }
  }
  async close(): Promise<void> {
    for (const handle of [...this.sessions.keys()]) await this.dispose(handle);
    this.server?.close(); this.server = undefined;
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed OpenCode session');
    return session;
  }
}
