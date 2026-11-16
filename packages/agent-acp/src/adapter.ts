import { randomUUID } from 'node:crypto';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { AcpError, JsonRpcPeer } from './jsonrpc.ts';
import type { Spawn } from './jsonrpc.ts';
import type { AcpProfile, ConfigOption, SessionBootstrap, TurnMapper } from './profile.ts';
import { AcpPermissionBroker } from './permissions.ts';

export interface AcpEndpoint { peer: JsonRpcPeer; profile: AcpProfile; agentInfo: { name?: string; version?: string } }
type Session = SessionBootstrap & {
  peer: JsonRpcPeer; profile: AcpProfile; queue: EventQueue; broker: AcpPermissionBroker;
  active: boolean; disposed: boolean; needsRecovery: boolean; cancelRequested: boolean;
  mapper?: TurnMapper; running?: Promise<void>; turnDone?: Promise<string>; resolveTurn?: (reason: string) => void; agentVersion?: string;
};

/** Negotiate v2 first; a v1 answer on the same connection selects v1. -32022 with a supported list respawns at the highest common version. */
export async function connect(options: { executable: string; args: string[]; cwd?: string; spawn?: Spawn; onNotification?: (method: string, params: unknown) => void; onRequest?: (method: string, params: unknown) => Promise<unknown> }, profile: AcpProfile, fallback?: () => AcpProfile): Promise<AcpEndpoint> {
  const peer = JsonRpcPeer.spawnPeer(options);
  try {
    const result = await peer.request('initialize', profile.initializeParams());
    const parsed = profile.parseInitialize(result);
    return { peer, profile, agentInfo: parsed.info };
  } catch (error) {
    peer.close();
    if (error instanceof AcpError && error.code === -32022 && fallback) {
      const supported = (error.data as { supported?: unknown } | undefined)?.supported;
      const versions = Array.isArray(supported) ? supported : [];
      if (versions.includes(1)) {
        const v1 = fallback();
        const retry = JsonRpcPeer.spawnPeer(options);
        try {
          const result = await retry.request('initialize', v1.initializeParams());
          const parsed = v1.parseInitialize(result);
          return { peer: retry, profile: v1, agentInfo: parsed.info };
        } catch (inner) { retry.close(); throw inner; }
      }
    }
    throw error;
  }
}

/** Generic ACP adapter for third-party agents. Supports negotiated v1 and v2; never assumes a vendor. */
export class AcpAdapter implements AgentAdapter {
  readonly id: string;
  readonly transport = 'acp' as const;
  readonly capabilities = NO_CAPABILITIES;
  private readonly sessions = new Map<Handle, Session>();
  private readonly options: { vendor?: string; command: string; args?: string[]; spawn?: Spawn; preferV1?: boolean; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { vendor?: string; command: string; args?: string[]; spawn?: Spawn; preferV1?: boolean; onNativeId?: (handle: Handle, id: string) => void }) {
    if (!options.command) throw new Error('ACP command is required');
    this.options = options; this.id = options.vendor ?? 'acp';
  }
  async detect() { return { available: true, reason: 'Generic ACP adapter; availability is negotiated at start' }; }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> {
    if (spec.model || spec.mode || spec.effort) {
      // Configuration goes through negotiated config options after session creation; seed it instead of failing.
    }
    if (!spec.cwd) throw new Error('cwd is required');
    return this.create(spec.cwd, undefined, spec);
  }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id || !ref.cwd) throw new Error('native session ID and cwd are required');
    return this.create(ref.cwd, ref.id);
  }
  private async create(cwd: string, existingId: string | undefined, spec?: StartSpec): Promise<Handle> {
    const { createV2Profile } = await import('./v2.ts');
    const { createV1Profile } = await import('./v1.ts');
    let session: Session | undefined;
    const primary = this.options.preferV1 ? createV1Profile() : createV2Profile();
    const endpoint = await connect({
      executable: this.options.command, args: this.options.args ?? [], cwd, spawn: this.options.spawn,
      onNotification: (method, params) => {
        if (method === 'session/update' && session?.active && session.mapper) session.queue.push(session.mapper.update(params));
      },
      onRequest: (_method, params) => session?.active ? session.broker.request(params, session.nativeId) : Promise.resolve({ outcome: { outcome: 'cancelled' } }),
    }, primary, createV1Profile);
    try {
      const bootstrap = existingId ? await endpoint.profile.resumeSession(endpoint.peer, existingId, cwd) : await endpoint.profile.newSession(endpoint.peer, cwd);
      const handle = Object.freeze({ id: `acp-${randomUUID()}` });
      const queue = new EventQueue();
      session = {
        ...bootstrap, peer: endpoint.peer, profile: endpoint.profile, queue,
        broker: new AcpPermissionBroker(event => queue.push([event])),
        active: false, disposed: false, needsRecovery: false, cancelRequested: false,
      };
      this.options.onNativeId?.(handle, bootstrap.nativeId);
      this.sessions.set(handle, session);
      if (endpoint.agentInfo.version) session.agentVersion = endpoint.agentInfo.version;
      if (spec?.model || spec?.mode || spec?.effort) {
        // Best-effort initial configuration through config options when advertised.
        for (const [category, value] of [['mode', spec.mode], ['model', spec.model], ['thought_level', spec.effort]] as const) {
          if (value) await this.applyOption(handle, category, value).catch(() => { throw new Error(`Agent did not accept ${category} option`); });
        }
      }
      return handle;
    } catch (error) { endpoint.peer.close(); throw error; }
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('ACP session already has an active turn');
    if (session.needsRecovery) throw new Error('ACP session requires explicit recovery');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true; session.cancelRequested = false;
    session.turnDone = new Promise(resolve => { session.resolveTurn = resolve; });
    session.mapper = session.profile.createMapper(session.nativeId, reason => session.resolveTurn?.(reason));
    session.running = this.run(session, input.text);
  }
  private async run(session: Session, text: string): Promise<void> {
    let completed = false;
    try {
      const early = await session.profile.sendPrompt(session.peer, session.nativeId, text);
      const reason = early ?? await session.turnDone!;
      if (session.disposed) return;
      session.queue.push(session.mapper!.finish());
      if (session.cancelRequested || reason === 'cancelled') {
        session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]);
      } else if (reason === 'end_turn') completed = true;
      else { session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: `acp_${reason}` }]); }
    } catch (error) {
      session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'ACP turn failed' }, { kind: 'interrupted', reason: 'acp_error' }]); }
        catch { session.queue.close(); }
      }
    } finally {
      session.broker.expireAll('turn_finished');
      session.active = false; session.mapper = undefined;
      if (completed && !session.disposed) { try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); } }
    }
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active) throw new Error('ACP session has no active turn');
    session.cancelRequested = true; session.broker.expireAll('cancelled'); session.profile.cancel(session.peer, session.nativeId);
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> { this.get(handle).broker.decide(requestId, optionId); }
  private async applyOption(handle: Handle, category: string, value: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('ACP session has an active turn');
    const option = session.options.find(entry => entry.category === category);
    if (option) {
      session.options = await session.profile.setConfigOption(session.peer, session.nativeId, option, value);
      return;
    }
    if (category === 'mode' && session.modes.length) {
      await session.profile.setMode(session.peer, session.nativeId, value);
      session.currentMode = value;
      return;
    }
    throw new Error(`Agent did not advertise a ${category} config option`);
  }
  async setOption(handle: Handle, id: string, value: string | boolean): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('ACP session has an active turn');
    const option = session.options.find(entry => entry.id === id);
    if (!option) throw new Error(`Unknown ACP config option ${id}`);
    session.options = await session.profile.setConfigOption(session.peer, session.nativeId, option, value);
    session.queue.push([{ kind: 'config_option', id, value }]);
  }
  async setMode(handle: Handle, mode: string): Promise<void> {
    await this.applyOption(handle, 'mode', mode);
    this.get(handle).queue.push([{ kind: 'mode_changed', mode }]);
  }
  async setModel(handle: Handle, model: string): Promise<void> {
    await this.applyOption(handle, 'model', model);
    this.get(handle).queue.push([{ kind: 'model_changed', model }]);
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    await this.applyOption(handle, 'thought_level', effort);
    this.get(handle).queue.push([{ kind: 'effort_changed', effort }]);
  }
  /** Negotiated protocol version for this session (1 or 2), stored and shown per the README. */
  acpVersion(handle: Handle): 1 | 2 { return this.get(handle).profile.version; }
  agentVersion(handle: Handle): string | undefined { return this.get(handle).agentVersion; }
  configOptions(handle: Handle): ConfigOption[] { return this.get(handle).options; }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.broker.expireAll('disposed'); session.peer.close(); await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed ACP session');
    return session;
  }
}
