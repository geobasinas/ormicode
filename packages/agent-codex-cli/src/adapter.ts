import { spawn } from 'node:child_process';
import { EventQueue, NO_CAPABILITIES, RawLog, classifyCommand } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, ModelList, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { ulid } from 'ulid';
import * as z from 'zod/mini';
import { CodexAppServer } from './app-server.ts';
import { CodexNotificationMapper } from './map.ts';

type Spawn = NonNullable<Parameters<typeof CodexAppServer.start>[0]>['spawn'];
const APPROVAL_OPTIONS = [{ id: 'accept', label: 'Approve' }, { id: 'acceptForSession', label: 'Approve for session' }, { id: 'decline', label: 'Decline' }, { id: 'cancel', label: 'Cancel turn' }];

interface Pending { resolve: (result: unknown) => void; turnId?: string; respond?: (option: string) => unknown; options?: string[] }
interface Session {
  server: CodexAppServer; queue: EventQueue; log?: RawLog;
  nativeId?: string; turnId?: string; active: boolean; disposed: boolean;
  model?: string; usageModel?: string; effort?: string; outputSchema?: unknown; backlog: string[];
  approvals: Map<string, Pending>; questions: Map<string, Pending>; mapper: CodexNotificationMapper;
}

/** Codex app-server adapter: threads, turns, approvals, steering, per-turn model/effort. */
export class CodexCliAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly transport = 'cli' as const;
  readonly capabilities = { ...NO_CAPABILITIES, approvals: true, steer: true, resume: true, model: true, effort: true, configOptions: true };
  private readonly sessions = new Map<Handle, Session>();
  private readonly spawnFn?: Spawn;
  private readonly onNativeId?: (handle: Handle, id: string) => void;
  private serial = 0;
  constructor(options: { spawn?: Spawn; onNativeId?: (handle: Handle, id: string) => void } = {}) { this.spawnFn = options.spawn; this.onNativeId = options.onNativeId; }
  async detect() {
    const version = await new Promise<string | undefined>((resolve) => {
      const child = spawn('codex', ['--version'], { windowsHide: true, shell: false });
      let out = ''; child.stdout.on('data', (chunk) => { out += chunk; });
      child.once('error', () => resolve(undefined)); child.once('close', (code) => resolve(code === 0 ? out.trim() : undefined));
      setTimeout(() => { child.kill(); resolve(undefined); }, 10_000).unref();
    });
    return version ? { available: true, version } : { available: false, reason: 'codex executable not found or --version failed' };
  }
  async models(): Promise<ModelList> {
    const server = await this.openServer();
    try {
      const [models, configured] = await Promise.all([server.models(), server.configuredModel()]);
      const listed = models.map((model) => ({ id: model.id, ...(model.name ? { name: model.name } : {}), ...(model.efforts ? { efforts: model.efforts } : {}) }));
      // The picker catalog only advertises what the server currently promotes; the
      // configured default is what an unflagged run actually uses, so keep it selectable.
      if (configured && !listed.some((model) => model.id === configured)) return [{ id: configured, name: `${configured} (config default)` }, ...listed];
      return listed;
    }
    finally { server.close(); }
  }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> {
    if (!ref.id) throw new Error('native thread ID is required');
    return this.create(ref, ref.id);
  }
  private async create(spec: StartSpec, nativeId?: string): Promise<Handle> {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode && spec.mode !== 'read-only' && spec.mode !== 'workspace-write') throw new Error('Unsupported or unsafe sandbox mode');
    const session: Session = { server: undefined as unknown as CodexAppServer, queue: new EventQueue(), active: false, disposed: false, backlog: [], approvals: new Map(), questions: new Map(), mapper: new CodexNotificationMapper(), ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { effort: spec.effort } : {}), ...(nativeId ? { nativeId } : {}) };
    const handle = Object.freeze({ id: `codex-cli-${++this.serial}` });
    session.log = spec.logDir ? new RawLog(spec.logDir) : undefined;
    session.server = await this.openServer(session);
    // `workspace-write` + `on-request` edits the workspace without asking. The default keeps the
    // sandbox read-only so every write escalates as a fileChange/commandExecution approval.
    const sandbox = spec.mode ?? 'read-only';
    try {
      const id = nativeId
        ? await session.server.resumeThread({ threadId: nativeId, cwd: spec.cwd, model: spec.model, sandbox, approvalPolicy: 'on-request' })
        : await session.server.startThread({ cwd: spec.cwd, model: spec.model, sandbox, approvalPolicy: 'on-request' });
      session.nativeId = id; session.usageModel = session.server.model;
      this.onNativeId?.(handle, id);
    } catch (error) { session.server.close(); throw error; }
    this.sessions.set(handle, session);
    return handle;
  }
  /** Only a full session gets handlers; a bare server (e.g. `models()`) ignores notifications. */
  private openServer(session?: Session): Promise<CodexAppServer> {
    const live = session?.mapper && session.queue ? session : undefined;
    return CodexAppServer.start({
      spawn: this.spawnFn, log: session?.log,
      onNotification: live ? (method, params) => this.onNotification(live, method, params) : undefined,
      onRequest: live ? (method, params) => this.onRequest(live, method, params) : undefined,
    });
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Codex session already has an active turn');
    if (!input.text) throw new Error('prompt must not be empty');
    const text = session.backlog.length ? `${session.backlog.join('\n\n')}\n\n${input.text}` : input.text;
    session.backlog = [];
    const extra: Record<string, unknown> = {};
    if (session.model) extra.model = session.model;
    if (session.effort) extra.effort = session.effort;
    if (session.outputSchema !== undefined) extra.outputSchema = session.outputSchema;
    session.active = true;
    session.turnId = await session.server.startTurn(session.nativeId as string, text, extra).catch((error) => { session.active = false; throw error; });
  }
  async steer(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (!input.text) throw new Error('steer text must not be empty');
    if (session.active && session.turnId) await session.server.steerTurn(session.nativeId as string, session.turnId, input.text);
    else session.backlog.push(input.text);
  }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle); session.model = model; session.usageModel = model;
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.get(handle); session.effort = effort;
    session.queue.push([{ kind: 'effort_changed', effort }]);
  }
  async setOption(handle: Handle, id: string, value: string | boolean): Promise<void> {
    const session = this.get(handle);
    if (id !== 'outputSchema' || typeof value === 'boolean') throw new Error('Unknown Codex option');
    try { session.outputSchema = value ? JSON.parse(value) : undefined; } catch { throw new Error('outputSchema must be valid JSON'); }
    session.queue.push([{ kind: 'config_option', id, value }]);
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> {
    const session = this.get(handle);
    const pending = session.approvals.get(requestId);
    if (!pending) throw new Error(`Unknown approval request: ${requestId}`);
    if (!(pending.options ?? APPROVAL_OPTIONS.map(option => option.id)).includes(optionId)) throw new Error('Unknown approval option');
    session.approvals.delete(requestId);
    if (!session.active || !session.turnId || pending.turnId !== session.turnId) {
      session.queue.push([{ kind: 'interaction_expired', request: requestId, reason: 'turn_ended' }]);
      throw new Error('Approval expired: its turn has ended');
    }
    session.queue.push([{ kind: 'approval_decision', request: requestId, option: optionId }]);
    pending.resolve(pending.respond ? pending.respond(optionId) : { decision: optionId });
  }
  async answerQuestion(handle: Handle, requestId: string, answers: Record<string, string>): Promise<void> {
    const pending = this.get(handle).questions.get(requestId);
    if (!pending) throw new Error(`Unknown question request: ${requestId}`);
    this.get(handle).questions.delete(requestId);
    pending.resolve({ answers: Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answers: [answer] }])) });
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active || !session.turnId) throw new Error('Codex session has no active turn');
    const turnId = session.turnId;
    await session.server.interruptTurn(session.nativeId as string, turnId);
    this.expireTurnInteractions(session, turnId);
  }
  private expireTurnInteractions(session: Session, turnId: string): void {
    for (const [pending, result] of [[session.approvals, { decision: 'cancel' }], [session.questions, { answers: {} }]] as const) {
      for (const [request, entry] of pending) {
        if (entry.turnId !== turnId) continue;
        pending.delete(request);
        session.queue.push([{ kind: 'interaction_expired', request, reason: 'cancelled' }]);
        entry.resolve(entry.respond ? entry.respond('decline') : result);
      }
    }
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle); if (!session) return;
    session.disposed = true; session.approvals.clear(); session.questions.clear();
    session.server.close(); session.queue.close(); this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed Codex session');
    return session;
  }
  private onNotification(session: Session, method: string, params: unknown): void {
    if (!session.mapper || !session.queue) return;
    try { this.handleNotification(session, method, params); }
    catch (error) { session.queue.push([{ kind: 'error', code: 'unknown', message: `notification ${method}: ${error instanceof Error ? error.message : error}` }]); }
  }
  private handleNotification(session: Session, method: string, params: unknown): void {
    if (session.disposed) return;
    const mapped = session.mapper.map(method, params, session.usageModel);
    if (mapped.nativeId) session.nativeId = mapped.nativeId;
    if (mapped.turnId) session.turnId = mapped.turnId;
    const ended = mapped.ended?.turnId ?? session.turnId;
    if (mapped.ended?.interrupted && ended) this.expireTurnInteractions(session, ended);
    if (mapped.events.length) session.queue.push(mapped.events);
    if (mapped.ended) { session.active = false; session.turnId = undefined; session.queue.push([{ kind: 'turn_end' }]); }
  }
  private onRequest(session: Session, method: string, params: unknown): Promise<unknown> {
    const p = params as { turnId?: string; approvalId?: string; itemId?: string; command?: string; reason?: string; permissions?: Record<string, unknown>; questions?: { id: string; question: string; header: string; options?: { label: string; description?: string }[] | null }[] };
    const id = `req_${ulid()}`;
    if (method === 'item/permissions/requestApproval') {
      if (!p.permissions || typeof p.permissions !== 'object' || Array.isArray(p.permissions)) throw new Error('Invalid permissions request');
      const permissions = Object.fromEntries(Object.entries(p.permissions).filter(([key, value]) => ['network', 'fileSystem'].includes(key) && value != null));
      const options = APPROVAL_OPTIONS.filter(option => option.id !== 'cancel');
      session.queue.push([{ kind: 'approval_request', request: id, options, reason: p.reason, target: z.parse(z.json(), p.permissions) }]);
      return new Promise(resolve => { session.approvals.set(id, {
        resolve, turnId: p.turnId ?? session.turnId, options: options.map(option => option.id),
        respond: option => ({ permissions: option === 'accept' || option === 'acceptForSession' ? permissions : {}, scope: option === 'acceptForSession' ? 'session' : 'turn' }),
      }); });
    }
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const hit = classifyCommand(String(p.command ?? ''));
      session.queue.push([{ kind: 'approval_request', request: id, options: APPROVAL_OPTIONS, ...(hit ? { destructive: true, rule: hit.rule } : {}) }]);
      return new Promise((resolve) => { session.approvals.set(id, { resolve, turnId: p.turnId ?? session.turnId }); });
    }
    if (method === 'item/tool/requestUserInput') {
      session.queue.push([{ kind: 'question_request', request: id, questions: (p.questions ?? []).map((q) => ({ question: q.question, header: q.header, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })), multiSelect: false })) }]);
      return new Promise((resolve) => { session.questions.set(id, { resolve, turnId: p.turnId ?? session.turnId }); });
    }
    throw new Error(`Unsupported app-server request: ${method}`);
  }
}
