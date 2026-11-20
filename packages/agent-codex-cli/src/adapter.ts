import { spawn } from 'node:child_process';
import { EventQueue, NO_CAPABILITIES, RawLog, classifyCommand } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, ModelList, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import type { AgentEvent } from '@ormicode/protocol';
import { ulid } from 'ulid';
import { CodexEventMapper } from '@ormicode/agent-codex-sdk';
import { CodexAppServer } from './app-server.ts';

type Spawn = NonNullable<Parameters<typeof CodexAppServer.start>[0]>['spawn'];
interface AppItem { type?: string; id?: string; text?: string; command?: string; aggregatedOutput?: string; exitCode?: number; status?: string; server?: string; tool?: string; arguments?: unknown; result?: unknown; error?: unknown; changes?: unknown; items?: { text?: string; completed?: boolean }[]; summary?: string[] }
/** Translate app-server camelCase items into the exec-style items the shared mapper understands. */
function translateItem(item: unknown): unknown {
  const it = item as AppItem;
  if (!it || typeof it !== 'object') return item;
  if (it.type === 'agentMessage') return { type: 'agent_message', id: it.id, text: it.text ?? '' };
  if (it.type === 'reasoning') return { type: 'reasoning', id: it.id, text: it.text ?? (it.summary ?? []).join('\n') };
  if (it.type === 'commandExecution') return { type: 'command_execution', id: it.id, command: it.command ?? '', aggregated_output: it.aggregatedOutput ?? '', exit_code: it.exitCode, status: it.status };
  if (it.type === 'mcpToolCall') return { type: 'mcp_tool_call', id: it.id, server: it.server ?? '', tool: it.tool ?? '', arguments: it.arguments ?? null, result: it.result, error: it.error, status: it.status };
  if (it.type === 'fileChange') return { type: 'file_change', id: it.id, changes: it.changes ?? [], status: it.status };
  if (it.type === 'plan') return { type: 'todo_list', id: it.id, items: (it.items ?? []).map((entry) => ({ text: entry.text ?? '', completed: !!entry.completed })) };
  return item;
}
const APPROVAL_OPTIONS = [{ id: 'accept', label: 'Approve' }, { id: 'acceptForSession', label: 'Approve for session' }, { id: 'decline', label: 'Decline' }, { id: 'cancel', label: 'Cancel turn' }];

interface Pending { resolve: (result: unknown) => void }
interface Session {
  server: CodexAppServer; queue: EventQueue; log?: RawLog;
  nativeId?: string; turnId?: string; active: boolean; disposed: boolean;
  model?: string; effort?: string; outputSchema?: unknown; backlog: string[]; lastUsage?: { input_tokens: number; output_tokens: number; cached_input_tokens: number; cache_write_input_tokens: number };
  approvals: Map<string, Pending>; questions: Map<string, Pending>; mapper?: CodexEventMapper;
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
    const server = await this.openServer({});
    try { return (await server.models()).map((model) => ({ id: model.id, ...(model.name ? { name: model.name } : {}), ...(model.efforts ? { efforts: model.efforts } : {}) })); }
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
    const session: Session = { server: undefined as unknown as CodexAppServer, queue: new EventQueue(), active: false, disposed: false, backlog: [], approvals: new Map(), questions: new Map(), ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { effort: spec.effort } : {}), ...(nativeId ? { nativeId } : {}) };
    const handle = Object.freeze({ id: `codex-cli-${++this.serial}` });
    session.log = spec.logDir ? new RawLog(spec.logDir) : undefined;
    session.server = await this.openServer(session);
    try {
      const id = nativeId
        ? await session.server.resumeThread({ threadId: nativeId, cwd: spec.cwd, model: spec.model, sandbox: spec.mode ?? 'read-only', approvalPolicy: 'on-request' })
        : await session.server.startThread({ cwd: spec.cwd, model: spec.model, sandbox: spec.mode ?? 'read-only', approvalPolicy: 'on-request' });
      session.nativeId = id;
      this.onNativeId?.(handle, id);
    } catch (error) { session.server.close(); throw error; }
    this.sessions.set(handle, session);
    return handle;
  }
  private openServer(session?: Partial<Session>): Promise<CodexAppServer> {
    return CodexAppServer.start({
      spawn: this.spawnFn, log: session?.log,
      onNotification: session ? (method, params) => this.onNotification(session as Session, method, params) : undefined,
      onRequest: session ? (method, params) => this.onRequest(session as Session, method, params) : undefined,
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
    const session = this.get(handle); session.model = model;
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
    session.approvals.delete(requestId);
    session.queue.push([{ kind: 'approval_decision', request: requestId, option: optionId }]);
    pending.resolve({ decision: optionId });
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
    await session.server.interruptTurn(session.nativeId as string, session.turnId);
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
    try { this.handleNotification(session, method, params); }
    catch (error) { session.queue.push([{ kind: 'error', code: 'unknown', message: `notification ${method}: ${error instanceof Error ? error.message : error}` }]); }
  }
  private handleNotification(session: Session, method: string, params: unknown): void {
    if (session.disposed) return;
    const p = params as Record<string, never>;
    const mapper = session.mapper ??= new CodexEventMapper();
    const feed = (event: unknown) => {
      const mapped = mapper.map(event as never);
      if (mapped.nativeId) session.nativeId = mapped.nativeId;
      if (mapped.events.length) session.queue.push(mapped.events as AgentEvent[]);
      if (mapped.terminal) { session.active = false; session.turnId = undefined; session.queue.push([{ kind: 'turn_end' }]); }
    };
    if (method === 'item/started') feed({ type: 'item.started', item: translateItem(p.item) });
    else if (method === 'item/completed') feed({ type: 'item.completed', item: translateItem(p.item) });
    else if (method === 'turn/started') { session.turnId = (p.turn as { id: string }).id; feed({ type: 'turn.started' }); }
    else if (method === 'turn/completed') {
      const turn = p.turn as { status?: string; error?: { message?: string } | null };
      if (turn?.status === 'failed' || turn?.error?.message) feed({ type: 'turn.failed', error: { message: turn.error?.message ?? 'turn failed' } });
      else feed({ type: 'turn.completed', usage: session.lastUsage ?? { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0 } });
      session.lastUsage = undefined;
    }
    else if (method === 'thread/tokenUsage/updated') {
      const last = (p.tokenUsage as { last?: Record<string, number> })?.last;
      if (last) session.lastUsage = { input_tokens: last.inputTokens ?? 0, output_tokens: last.outputTokens ?? 0, cached_input_tokens: last.cachedInputTokens ?? 0, cache_write_input_tokens: last.cacheWriteInputTokens ?? 0 };
    }
    else if (method === 'thread/started') session.nativeId = (p.thread as { id: string }).id;
    else if (method === 'item/agentMessage/delta') session.queue.push([{ kind: 'text_delta', text: (p.delta as string) ?? '' }]);
    else if (method === 'item/reasoning/textDelta') session.queue.push([{ kind: 'thinking_delta', text: (p.delta as string) ?? '' }]);
    else if (method === 'item/plan/delta') session.queue.push([{ kind: 'text_delta', text: (p.delta as string) ?? '' }]);
    else if (method === 'error') session.queue.push([{ kind: 'error', code: 'unknown', message: String((p as { message?: string }).message ?? 'Codex app-server error') }]);
  }
  private onRequest(session: Session, method: string, params: unknown): Promise<unknown> {
    const p = params as { approvalId?: string; itemId?: string; command?: string; reason?: string; questions?: { id: string; question: string; header: string; options?: { label: string; description?: string }[] | null }[] };
    const id = `req_${ulid()}`;
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval' || method === 'item/permissions/requestApproval') {
      const hit = classifyCommand(String(p.command ?? ''));
      session.queue.push([{ kind: 'approval_request', request: id, options: APPROVAL_OPTIONS, ...(hit ? { destructive: true, rule: hit.rule } : {}) }]);
      return new Promise((resolve) => { session.approvals.set(id, { resolve }); });
    }
    if (method === 'item/tool/requestUserInput') {
      session.queue.push([{ kind: 'question_request', request: id, questions: (p.questions ?? []).map((q) => ({ question: q.question, header: q.header, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })), multiSelect: false })) }]);
      return new Promise((resolve) => { session.questions.set(id, { resolve }); });
    }
    throw new Error(`Unsupported app-server request: ${method}`);
  }
}
