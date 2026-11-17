import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createAgentSession, ModelRuntime, SessionManager, resolveCliModel } from '@earendil-works/pi-coding-agent';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, ModelList, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { PiSdkMapper } from './map.ts';

export interface PiSessionLike {
  sessionId: string;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<unknown>;
  abort(): Promise<void>;
  setModel(model: unknown): Promise<void>;
  setThinkingLevel(level: unknown): void;
  dispose(): void;
}
export type PiCreateOptions = { cwd: string; model?: unknown; thinkingLevel?: string; sessionManager?: unknown };
export type PiCreateSession = (options: PiCreateOptions) => Promise<{ session: PiSessionLike }>;
type Session = {
  session: PiSessionLike; queue: EventQueue; mapper: PiSdkMapper; unsubscribe: () => void;
  spec: StartSpec; nativeId: string; active: boolean; disposed: boolean; needsRecovery: boolean;
  interruptRequested: boolean; settledAborted: boolean; running?: Promise<void>;
};
const execFileAsync = promisify(execFile);
const efforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const defaultCreate: PiCreateSession = async options => {
  const result = await createAgentSession(options as CreateAgentSessionOptions);
  return { session: result.session as unknown as PiSessionLike };
};

/** pi SDK adapter over `createAgentSession`. pi has no approvals or sandbox; tools follow pi's own permissions. */
export class PiSdkAdapter implements AgentAdapter {
  readonly id = 'pi';
  readonly transport = 'sdk' as const;
  readonly capabilities = NO_CAPABILITIES;
  private readonly sessions = new Map<Handle, Session>();
  private readonly create: PiCreateSession;
  private readonly onNativeId?: (handle: Handle, id: string) => void;
  private readonly openSession?: (cwd: string, id: string) => Promise<unknown>;
  private readonly resolveModelRef?: (ref: string) => Promise<unknown>;
  private runtime?: ModelRuntime;
  constructor(options: { create?: PiCreateSession; openSession?: (cwd: string, id: string) => Promise<unknown>; resolveModel?: (ref: string) => Promise<unknown>; onNativeId?: (handle: Handle, id: string) => void } = {}) {
    this.create = options.create ?? defaultCreate;
    this.openSession = options.openSession;
    this.resolveModelRef = options.resolveModel;
    this.onNativeId = options.onNativeId;
  }
  async detect() {
    try {
      const { stdout } = await execFileAsync('pi', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication not checked' };
    } catch { return { available: false, reason: 'pi CLI not found or version check failed' }; }
  }
  async models(): Promise<ModelList> {
    this.runtime ??= await ModelRuntime.create();
    return this.runtime.getModels().map(model => ({ id: `${model.provider}/${model.id}`, name: model.name }));
  }
  private async resolveModel(ref: string): Promise<unknown> {
    if (this.resolveModelRef) return this.resolveModelRef(ref);
    this.runtime ??= await ModelRuntime.create();
    const result = resolveCliModel({ cliModel: ref, modelRuntime: this.runtime });
    if (result.error || !result.model) throw new Error(result.error ?? `pi model not found: ${ref}`);
    return result.model;
  }
  async start(spec: StartSpec): Promise<Handle> {
    if (spec.mode) throw new Error('pi modes are not supported');
    if (spec.effort && !efforts.includes(spec.effort)) throw new Error('Unsupported pi thinking level');
    const model = spec.model ? await this.resolveModel(spec.model) : undefined;
    return this.attach(spec, await this.create({ cwd: spec.cwd, ...(model !== undefined ? { model } : {}), ...(spec.effort ? { thinkingLevel: spec.effort } : {}) }));
  }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id || !ref.cwd) throw new Error('native session ID and cwd are required');
    const open = this.openSession ?? (async (cwd: string, id: string) => {
      const path = SessionManager.findById(cwd, id);
      if (!path) throw new Error(`pi session not found: ${id}`);
      return SessionManager.open(path, undefined, cwd);
    });
    const sessionManager = await open(ref.cwd, ref.id);
    return this.attach({ cwd: ref.cwd }, await this.create({ cwd: ref.cwd, sessionManager }));
  }
  private attach(spec: StartSpec, result: { session: PiSessionLike }): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    const session = result.session;
    const handle = Object.freeze({ id: `pi-sdk-${randomUUID()}` });
    const queue = new EventQueue();
    const record: Session = {
      session, queue, mapper: new PiSdkMapper(), unsubscribe: () => { },
      spec: { ...spec }, nativeId: session.sessionId, active: false, disposed: false,
      needsRecovery: false, interruptRequested: false, settledAborted: false,
    };
    record.unsubscribe = session.subscribe(event => {
      if (record.disposed) return;
      try {
        const mapped = record.mapper.map(event);
        if (mapped.aborted !== undefined) record.settledAborted = mapped.aborted;
        if (mapped.events.length) queue.push(mapped.events);
      } catch { record.needsRecovery = true; }
    });
    this.sessions.set(handle, record);
    this.onNativeId?.(handle, record.nativeId);
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.needsRecovery) throw new Error('pi session requires explicit recovery');
    if (session.active) throw new Error('pi session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true; session.interruptRequested = false; session.settledAborted = false;
    session.mapper = new PiSdkMapper();
    session.running = this.run(session, input.text);
  }
  private async run(session: Session, text: string): Promise<void> {
    let completed = false;
    try {
      await session.session.prompt(text);
      if (session.disposed) return;
      const trailing = session.mapper.finish();
      if (trailing.length) session.queue.push(trailing);
      if (session.interruptRequested || session.settledAborted) {
        session.needsRecovery = true;
        session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]);
      } else completed = true;
    } catch (error) {
      session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'pi SDK failed' }, { kind: 'interrupted', reason: session.interruptRequested ? 'user_abort' : 'pi_sdk_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.active = false;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async steer(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('pi session has no active turn');
    if (!input.text) throw new Error('steer must not be empty');
    await session.session.steer(input.text);
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('pi session has no active turn');
    session.interruptRequested = true;
    await session.session.abort();
  }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('pi session has an active turn');
    if (!model) throw new Error('model is required');
    await session.session.setModel(await this.resolveModel(model));
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('pi session has an active turn');
    if (!efforts.includes(effort)) throw new Error('Unsupported pi thinking level');
    session.session.setThinkingLevel(effort);
    session.queue.push([{ kind: 'effort_changed', effort }]);
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.unsubscribe(); session.session.dispose();
    await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed pi session');
    return session;
  }
}
