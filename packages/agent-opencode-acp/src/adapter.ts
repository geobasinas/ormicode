import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { EventQueue, NO_CAPABILITIES, RawLog } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { AcpConnection } from './connection.ts';
import { OpenCodeTurnMapper } from './map.ts';
import { OpenCodePermissionBroker } from './permissions.ts';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { acpMcpServers } from './options.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { connection: AcpConnection; nativeId: string; queue: EventQueue; broker: OpenCodePermissionBroker; active: boolean; disposed: boolean; needsRecovery: boolean; mapper?: OpenCodeTurnMapper; running?: Promise<void>; cancelRequested: boolean };
const execFileAsync = promisify(execFile);

/** OpenCode ACP adapter (`opencode acp`, protocol v1). Permission choices are forwarded without changing their scope. */
export class OpenCodeAcpAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly transport = 'acp' as const;
  readonly capabilities = { ...NO_CAPABILITIES, approvals: true, resume: true };
  private readonly sessions = new Map<Handle, Session>();
  private readonly options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'opencode', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication and ACP support not checked' };
    } catch { return { available: false, reason: 'OpenCode CLI not found or version check failed' }; }
  }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> {
    if (spec.model || spec.mode || spec.effort) throw new Error('OpenCode ACP configuration is not yet supported');
    return this.create(spec.cwd, undefined, spec.logDir, spec.mcpServers);
  }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create(ref.cwd, ref.id, ref.logDir, ref.mcpServers);
  }
  private async create(cwd: string, existingId?: string, logDir?: string, mcpServers?: StartSpec['mcpServers']): Promise<Handle> {
    if (!cwd) throw new Error('cwd is required');
    let session: Session | undefined;
    const connection = await AcpConnection.start({ executable: this.options.executable ?? 'opencode', args: ['acp'], cwd, spawn: this.options.spawn, log: logDir ? new RawLog(logDir) : undefined, onNotification: (method, params) => {
      if (method === 'session/update' && session?.active && session.mapper) session.queue.push(session.mapper.update(params));
    }, onRequest: (_method, params) => session?.active ? session.broker.request(params, session.nativeId) : Promise.resolve({ outcome: { outcome: 'cancelled' } }) });
    try {
      const nativeId = existingId ?? await connection.newSession(cwd, acpMcpServers(mcpServers));
      if (existingId) await connection.loadSession(existingId, cwd, acpMcpServers(mcpServers));
      const handle = Object.freeze({ id: `opencode-acp-${randomUUID()}` });
      const queue = new EventQueue();
      session = { connection, nativeId, queue, broker: new OpenCodePermissionBroker(event => queue.push([event])), active: false, disposed: false, needsRecovery: false, cancelRequested: false };
      this.options.onNativeId?.(handle, nativeId);
      this.sessions.set(handle, session);
      return handle;
    } catch (error) { connection.close(); throw error; }
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('OpenCode session already has an active turn');
    if (session.needsRecovery) throw new Error('OpenCode session requires explicit recovery');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true; session.cancelRequested = false; session.mapper = new OpenCodeTurnMapper(session.nativeId);
    session.running = this.run(session, input.text);
  }
  private async run(session: Session, text: string): Promise<void> {
    let completed = false;
    try {
      const reason = await session.connection.prompt(session.nativeId, text);
      if (session.disposed) return;
      session.queue.push(session.mapper!.finish());
      if (session.cancelRequested || reason === 'cancelled') {
        session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]);
      } else if (reason === 'end_turn') completed = true;
      else { session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: `opencode_${reason}` }]); }
    } catch (error) {
      session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'OpenCode ACP failed' }, { kind: 'interrupted', reason: 'opencode_acp_error' }]); }
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
    if (!session.active) throw new Error('OpenCode session has no active turn');
    session.cancelRequested = true; session.broker.expireAll('cancelled'); session.connection.cancel(session.nativeId);
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> { this.get(handle).broker.decide(requestId, optionId); }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.broker.expireAll('disposed'); session.connection.close(); await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed OpenCode session');
    return session;
  }
}
