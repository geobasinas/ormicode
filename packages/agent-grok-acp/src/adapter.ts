import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { EventQueue, NO_CAPABILITIES, RawLog } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { AcpConnection } from './connection.ts';
import { acpMcpServers } from './options.ts';
import type { ConfigOption, Mode } from './options.ts';
import { GrokTurnMapper } from './map.ts';
import { GrokPermissionBroker } from './permissions.ts';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Session = { connection: AcpConnection; nativeId: string; queue: EventQueue; broker: GrokPermissionBroker; active: boolean; disposed: boolean; needsRecovery: boolean; mapper?: GrokTurnMapper; running?: Promise<void>; cancelRequested: boolean; options: ConfigOption[]; modes: Mode[]; currentMode?: string };
const execFileAsync = promisify(execFile);

/** ~/.grok/models_cache.json — `grok models` prints ids only; the cache carries
 *  display names and the per-model reasoning_efforts the API advertises. */
function grokModelCatalog(): Map<string, { name: string; efforts: string[] }> {
  try {
    const home = process.env.GROK_HOME ?? join(homedir(), '.grok');
    const raw = JSON.parse(readFileSync(join(home, 'models_cache.json'), 'utf8')) as { models?: Record<string, { info?: { hidden?: boolean; name?: string; reasoning_efforts?: { value?: string }[] } }> };
    const out = new Map<string, { name: string; efforts: string[] }>();
    for (const [id, entry] of Object.entries(raw.models ?? {})) {
      const info = entry.info;
      if (!info || info.hidden) continue;
      const efforts = (info.reasoning_efforts ?? []).map(e => e.value).filter((v): v is string => typeof v === 'string' && v.length > 0);
      out.set(id, { name: info.name ?? id, efforts });
    }
    return out;
  } catch { return new Map(); }
}

// Grok permission modes (https://docs.x.ai/build/features/permissions); on ACP they're set per session via
// `session/new` `_meta` (xai-org/grok-build docs, user-guide/15-agent-mode.md). Ask forwards each prompt as an approval card.
const GROK_ACP_MODES = [
  { id: 'ask', name: 'Ask', description: 'Asks before anything not already allowed', default: true },
  { id: 'auto', name: 'Auto', description: 'A classifier approves safe tools; risky ones still ask' },
  { id: 'always-approve', name: 'Always approve', description: 'Every tool runs without asking; deny rules and hooks still apply' },
];

/** Grok ACP adapter. Permission choices are forwarded without changing their scope. */
export class GrokAcpAdapter implements AgentAdapter {
  readonly id = 'grok';
  readonly transport = 'acp' as const;
  readonly capabilities = { ...NO_CAPABILITIES, approvals: true, resume: true, model: true, effort: true, configOptions: true };
  private readonly sessions = new Map<Handle, Session>();
  private readonly options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void };
  constructor(options: { executable?: string; spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.options = options; }
  async detect() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'grok', ['--version'], { timeout: 5000, windowsHide: true });
      const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
      return { available: Boolean(version), ...(version ? { version } : {}), reason: 'Authentication and ACP support not checked' };
    } catch { return { available: false, reason: 'Grok CLI not found or version check failed' }; }
  }
  async models() {
    try {
      const { stdout } = await execFileAsync(this.options.executable ?? 'grok', ['models'], { timeout: 15_000, windowsHide: true });
      const catalog = grokModelCatalog();
      return stdout.split('\n')
        .map(line => /^\s*[-*]\s+(\S+)/.exec(line)?.[1])
        .filter((id): id is string => Boolean(id))
        .map(id => ({ id, ...(catalog.get(id)?.name ? { name: catalog.get(id)!.name } : {}), ...(catalog.get(id)?.efforts.length ? { efforts: catalog.get(id)!.efforts } : {}) }));
    } catch { return []; }
  }
  async start(spec: StartSpec): Promise<Handle> {
    return this.create(spec.cwd, undefined, spec);
  }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native session ID is required');
    return this.create(ref.cwd, ref.id, ref);
  }
  /** Grok ACP advertises no session modes; its permission mode is picked on `session/new` `_meta` (yoloMode / autoMode). */
  agentModes() { return GROK_ACP_MODES; }
  private async create(cwd: string, existingId: string | undefined, spec?: StartSpec): Promise<Handle> {
    if (!cwd) throw new Error('cwd is required');
    if (spec?.mode && !GROK_ACP_MODES.some(m => m.id === spec.mode)) throw new Error('Unsupported or unsafe Grok permission mode');
    const meta: Record<string, boolean> | undefined = spec?.mode === 'always-approve' ? { yoloMode: true } : spec?.mode === 'auto' ? { autoMode: true } : undefined;
    let session: Session | undefined;
    const connection = await AcpConnection.start({ executable: this.options.executable ?? 'grok', args: ['--no-auto-update', 'agent', 'stdio'], cwd, spawn: this.options.spawn, log: spec?.logDir ? new RawLog(spec.logDir) : undefined, onNotification: (method, params) => {
      if (method === 'session/update' && session?.active && session.mapper) session.queue.push(session.mapper.update(params));
    }, onRequest: (_method, params) => session?.active ? session.broker.request(params, session.nativeId) : Promise.resolve({ outcome: { outcome: 'cancelled' } }) });
    try {
      const bootstrap = existingId ? await connection.loadSession(existingId, cwd, acpMcpServers(spec?.mcpServers)) : await connection.newSession(cwd, acpMcpServers(spec?.mcpServers), meta);
      const nativeId = bootstrap.sessionId;
      const handle = Object.freeze({ id: `grok-acp-${randomUUID()}` });
      const queue = new EventQueue();
      session = { connection, nativeId, queue, broker: new GrokPermissionBroker(event => queue.push([event])), active: false, disposed: false, needsRecovery: false, cancelRequested: false, options: bootstrap.options, modes: bootstrap.modes, ...(bootstrap.currentMode !== undefined ? { currentMode: bootstrap.currentMode } : {}) };
      this.options.onNativeId?.(handle, nativeId);
      this.sessions.set(handle, session);
      for (const [category, value] of [['model', spec?.model], [['thought_level', 'thinking'] as const, spec?.effort]] as const) {
        if (value) await this.applyOption(handle, category, value);
      }
      return handle;
    } catch (error) { connection.close(); throw error; }
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Grok session already has an active turn');
    if (session.needsRecovery) throw new Error('Grok session requires explicit recovery');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true; session.cancelRequested = false; session.mapper = new GrokTurnMapper(session.nativeId);
    session.running = this.run(session, input.text);
  }
  private async run(session: Session, text: string): Promise<void> {
    let completed = false;
    try {
      let usage: unknown;
      const reason = await session.connection.prompt(session.nativeId, text, 300_000, value => { usage = value; });
      if (session.disposed) return;
      session.queue.push(session.mapper!.finish(usage));
      if (session.cancelRequested || reason === 'cancelled') {
        session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: 'user_abort' }]);
      } else if (reason === 'end_turn') completed = true;
      else { session.needsRecovery = true; session.queue.push([{ kind: 'interrupted', reason: `grok_${reason}` }]); }
    } catch (error) {
      session.needsRecovery = true;
      if (!session.disposed) {
        try { session.queue.push([{ kind: 'error', code: 'unknown', message: error instanceof Error ? error.message : 'Grok ACP failed' }, { kind: 'interrupted', reason: 'grok_acp_error' }]); }
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
    if (!session.active) throw new Error('Grok session has no active turn');
    session.cancelRequested = true; session.broker.expireAll('cancelled'); session.connection.cancel(session.nativeId);
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> { this.get(handle).broker.decide(requestId, optionId); }
  private async applyOption(handle: Handle, category: string | readonly string[], value: string): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Grok session has an active turn');
    const categories = Array.isArray(category) ? category : [category];
    const option = session.options.find(entry => entry.category !== undefined && categories.includes(entry.category));
    if (option) { session.options = await session.connection.setConfigOption(session.nativeId, option.id, value); return; }
    if (categories.includes('mode') && session.modes.length) { await session.connection.setMode(session.nativeId, value); session.currentMode = value; return; }
    throw new Error(`Grok did not advertise a ${categories[0]} config option`);
  }
  async setOption(handle: Handle, id: string, value: string | boolean): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Grok session has an active turn');
    const option = session.options.find(entry => entry.id === id);
    if (!option) throw new Error(`Unknown Grok config option ${id}`);
    session.options = await session.connection.setConfigOption(session.nativeId, option.id, value);
    session.queue.push([{ kind: 'config_option', id, value }]);
  }
  async setMode(handle: Handle, mode: string): Promise<void> { await this.applyOption(handle, 'mode', mode); this.get(handle).queue.push([{ kind: 'mode_changed', mode }]); }
  async setModel(handle: Handle, model: string): Promise<void> { await this.applyOption(handle, 'model', model); this.get(handle).queue.push([{ kind: 'model_changed', model }]); }
  async setEffort(handle: Handle, effort: string): Promise<void> { await this.applyOption(handle, ['thought_level', 'thinking'], effort); this.get(handle).queue.push([{ kind: 'effort_changed', effort }]); }
  /** Advertised ACP config options for this session. */
  configOptions(handle: Handle): ConfigOption[] { return this.get(handle).options; }
  modes(handle: Handle): Mode[] { return this.get(handle).modes; }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.broker.expireAll('disposed'); session.connection.close(); await session.running; session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed Grok session');
    return session;
  }
}
