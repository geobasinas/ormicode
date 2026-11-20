import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, Options, PermissionResult, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventQueue, NO_CAPABILITIES, classifyCommand, loadDestructivePatterns, type DestructivePattern } from '@ormicode/agent-core';
import type { AgentAdapter, AgentCommand, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { monotonicFactory } from 'ulid';
import { parseEventBody } from '@ormicode/protocol';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mapSdkMessage } from './map.ts';
import { ThinkingCapture } from './thinking.ts';

type QueryFactory = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query;
interface PendingApproval { finish: (result: PermissionResult, reason?: string) => void; input: Record<string, unknown>; questions?: string[] }
/** Pushable async input for streaming-input mode: initial prompt + steered messages. */
interface TurnInput { push(text: string): void; close(): void; iterable: AsyncIterable<SDKUserMessage> }
interface Session {
  spec: StartSpec;
  queue: EventQueue;
  nativeId?: string;
  active: boolean;
  disposed: boolean;
  abort?: AbortController;
  running?: Promise<void>;
  stream?: Query;
  commandsQuery?: Query;
  commands: AgentCommand[];
  inputs?: TurnInput;
  needsResumeId: boolean;
  approvals: Map<string, PendingApproval>;
  steerBacklog: string[];
  logBytes: number;
}
const makeId = monotonicFactory();
const modes = new Set(['default', 'acceptEdits', 'plan', 'dontAsk']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const RAW_LOG_CAP = 5 * 1024 * 1024;

function turnInput(): TurnInput {
  const pending: SDKUserMessage[] = [];
  let waiter: ((r: IteratorResult<SDKUserMessage>) => void) | undefined;
  let closed = false;
  const message = (text: string): SDKUserMessage => ({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  return {
    push: text => { const m = message(text); if (waiter) { const w = waiter; waiter = undefined; w({ value: m, done: false }); } else pending.push(m); },
    close: () => { closed = true; if (waiter) { const w = waiter; waiter = undefined; w({ value: undefined, done: true } as IteratorResult<SDKUserMessage>); } },
    iterable: {
      [Symbol.asyncIterator]() {
        return { next: () => pending.length ? Promise.resolve({ value: pending.shift()!, done: false })
          : closed ? Promise.resolve({ value: undefined, done: true } as IteratorResult<SDKUserMessage>)
          : new Promise<IteratorResult<SDKUserMessage>>(resolve => { waiter = resolve; }) };
      },
    },
  };
}

const neverIterable: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}) }; } };
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** One SDK query per turn; native session IDs reconnect subsequent queries. */
export class ClaudeSdkAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly transport = 'sdk' as const;
  readonly capabilities = { ...NO_CAPABILITIES, approvals: true, steer: true, resume: true, model: true, effort: true, modes: true };
  private sessions = new Map<Handle, Session>();
  private destructivePatterns: readonly DestructivePattern[] | undefined;
  private readonly options: { query?: QueryFactory; onNativeId?: (handle: Handle, nativeId: string) => void };
  constructor(options: { query?: QueryFactory; onNativeId?: (handle: Handle, nativeId: string) => void } = {}) { this.options = options; }

  private destructive(): readonly DestructivePattern[] {
    if (!this.destructivePatterns) {
      const home = process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode');
      this.destructivePatterns = loadDestructivePatterns(join(home, 'destructive.json'));
    }
    return this.destructivePatterns;
  }

  /** Raw SDK traffic per the README's raw-log spec: stdout.log + meta.json, 5 MB cap. */
  private log(session: Session, file: 'stdout.log' | 'stderr.log' | 'meta.json', line: string): void {
    const dir = session.spec.logDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, file);
      if (file === 'meta.json') { writeFileSync(path, line); return; }
      if (session.logBytes > RAW_LOG_CAP) {
        // Oldest bytes dropped first: keep the last ~4 MB once over the cap.
        const tail = existsSync(path) ? readFileSync(path).subarray(-4 * 1024 * 1024) : Buffer.alloc(0);
        writeFileSync(path, tail);
        session.logBytes = tail.length;
      }
      appendFileSync(path, line + '\n');
      session.logBytes += line.length + 1;
    } catch { /* logging must never break a turn */ }
  }
  async detect() { return { available: true, reason: 'SDK package available; authentication not checked' }; }
  async models() {
    if (this.modelCache) return this.modelCache;
    const create = this.options.query ?? query;
    const probe = create({ prompt: neverIterable, options: {} });
    try {
      const list = await withTimeout(probe.supportedModels(), 15000);
      this.modelCache = list.map((model) => ({
        id: model.value,
        name: model.displayName,
        ...(model.supportedEffortLevels ? { efforts: model.supportedEffortLevels } : {}),
      }));
      return this.modelCache;
    } catch {
      return [];
    } finally {
      try { probe.close?.(); } catch { /* probe teardown is best-effort */ }
    }
  }
  private modelCache?: { id: string; name?: string; efforts?: readonly string[] }[];
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> { return this.create({ ...ref }, ref.id); }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode && !modes.has(spec.mode)) throw new Error('Unsupported or unsafe Claude permission mode');
    if (spec.effort && !efforts.has(spec.effort)) throw new Error('Unsupported Claude effort');
    const handle = Object.freeze({ id: `claude-${makeId()}` });
    this.sessions.set(handle, { spec, nativeId, queue: new EventQueue(), active: false, disposed: false, needsResumeId: false, approvals: new Map(), steerBacklog: [], logBytes: 0, commands: [] });
    return handle;
  }
  async prompt(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (session.active) throw new Error('Claude session already has an active turn');
    if (session.needsResumeId) throw new Error('Cannot continue: Claude did not provide a native session ID');
    if (!input.text) throw new Error('prompt must not be empty');
    session.queue.push([{ kind: 'turn_start' }]);
    session.active = true;
    const abort = new AbortController();
    session.abort = abort;
    session.running = this.run(handle, session, input.text, abort);
  }
  private async run(handle: Handle, session: Session, prompt: string, abort: AbortController): Promise<void> {
    let completed = false;
    const thinking = new ThinkingCapture();
    try {
      const permission: CanUseTool = async (name, input, context) => {
        const request = `req_${makeId()}`;
        let questions: string[] | undefined;
        if (name === 'AskUserQuestion') {
          const parsed = parseEventBody({ kind: 'question_request', request, questions: input.questions });
          if (!parsed.success || parsed.data.kind !== 'question_request' || parsed.data.questions.length === 0) {
            session.queue.push([{ kind: 'error', code: 'unknown', message: 'Claude sent an invalid question request' }]);
            return { behavior: 'deny', message: 'Invalid question request', interrupt: true };
          }
          questions = parsed.data.questions.map((item) => item.question);
          if (new Set(questions).size !== questions.length) {
            session.queue.push([{ kind: 'error', code: 'unknown', message: 'Claude sent duplicate question text' }]);
            return { behavior: 'deny', message: 'Ambiguous question request', interrupt: true };
          }
          session.queue.push([parsed.data]);
        } else {
        const options = [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }];
        // Destructive-command flag: Bash calls matching the pattern list are marked
        // so every client surfaces them prominently (parents can't approve them).
        const hit = name === 'Bash' && typeof input.command === 'string'
          ? classifyCommand(input.command, this.destructive()) : undefined;
        session.queue.push([{ kind: 'approval_request', request, options, tool: name, input, toolUseId: context.toolUseID, ...(hit ? { destructive: true, rule: hit.rule } : {}), ...(context.title ? { title: context.title } : {}), ...(context.description ? { description: context.description } : {}), ...(context.decisionReason ? { decisionReason: context.decisionReason } : {}), ...(context.blockedPath ? { blockedPath: context.blockedPath } : {}) }]);
        }
        return new Promise<PermissionResult>((resolve) => {
          const onAbort = () => finish({ behavior: 'deny', message: 'Approval interrupted', interrupt: true }, 'cancelled');
          const finish = (result: PermissionResult, reason?: string) => {
            context.signal.removeEventListener('abort', onAbort);
            if (!session.approvals.delete(request)) return;
            if (reason && !session.disposed) session.queue.push([{ kind: 'interaction_expired', request, reason }]);
            resolve(result);
          };
          session.approvals.set(request, { finish, input, questions });
          if (context.signal.aborted) onAbort();
          else context.signal.addEventListener('abort', onAbort, { once: true });
        });
      };
      const options: Options = {
        env: { ...process.env },
        cwd: session.spec.cwd, abortController: abort, includePartialMessages: true,
        thinking: { type: 'enabled', display: 'summarized' },
        settingSources: ['user', 'project', 'local'], tools: { type: 'preset', preset: 'claude_code' },
        permissionMode: (session.spec.mode ?? 'default') as Options['permissionMode'], canUseTool: permission,
        ...(session.spec.model ? { model: session.spec.model } : {}),
        ...(session.spec.effort ? { effort: session.spec.effort as Options['effort'] } : {}),
        ...(session.nativeId ? { resume: session.nativeId } : {}),
        ...(session.spec.mcpServers ? {
          mcpServers: Object.fromEntries(Object.entries(session.spec.mcpServers)
            .map(([name, s]) => [name, { type: 'stdio' as const, command: s.command, args: s.args ?? [], env: s.env ?? {} }])),
        } : {}),
      };
      // Streaming input: the initial prompt plus any steered messages and
      // steer backlog queued while no turn was active.
      const inputs = turnInput();
      inputs.push(prompt);
      for (const text of session.steerBacklog.splice(0)) inputs.push(text);
      session.inputs = inputs;
      const stream = (this.options.query ?? query)({ prompt: inputs.iterable, options });
      session.stream = stream;
      session.commandsQuery = stream;
      let reportedModel: string | undefined;
      for await (const message of stream) {
        if (session.disposed || abort.signal.aborted) break;
        this.log(session, 'stdout.log', JSON.stringify(message));
        if (message.type === 'system' && message.subtype === 'init') {
          this.log(session, 'meta.json', JSON.stringify({ command: 'claude-agent-sdk', cwd: session.spec.cwd, agentVersion: message.claude_code_version }));
        }
        if (message.type === 'assistant' && !message.parent_tool_use_id) reportedModel = message.message.model;
        const mapped = mapSdkMessage(message, { model: reportedModel });
        if (mapped.nativeId) {
          this.options.onNativeId?.(handle, mapped.nativeId);
          session.nativeId = mapped.nativeId;
        }
        if (message.type === 'result') { completed = true; inputs.close(); }
        const events = thinking.accept(mapped.events).filter((event) => event.kind !== 'turn_end');
        if (events.length) session.queue.push(events);
      }
      inputs.close();
      if (!completed && !session.disposed) session.queue.push([{ kind: 'interrupted', reason: abort.signal.aborted ? 'user_abort' : 'sdk_stream_ended' }]);
    } catch (error) {
      this.log(session, 'stderr.log', error instanceof Error ? error.stack ?? error.message : String(error));
      if (!session.disposed) {
        const reason = abort.signal.aborted ? 'user_abort' : 'sdk_error';
        try { session.queue.push([{ kind: 'interrupted', reason }, ...(abort.signal.aborted ? [] : [{ kind: 'error' as const, code: 'unknown', message: error instanceof Error ? error.message : 'Claude SDK failed' }])]); }
        catch { session.queue.close(); }
      }
    } finally {
      if (!session.disposed) { const remaining = thinking.flush(); if (remaining.length) session.queue.push(remaining); }
      for (const pending of session.approvals.values()) pending.finish({ behavior: 'deny', message: 'Session ended', interrupt: true }, 'turn_ended');
      session.active = false;
      session.abort = undefined;
      session.stream = undefined;
      session.inputs?.close();
      session.inputs = undefined;
      if (!session.nativeId) session.needsResumeId = true;
      if (completed && !session.disposed) {
        try { session.queue.push([{ kind: 'turn_end' }]); } catch { session.queue.close(); }
      }
    }
  }
  async approve(handle: Handle, requestId: string, optionId: string): Promise<void> {
    const session = this.get(handle);
    const pending = session.approvals.get(requestId);
    if (!pending) throw new Error('Approval is no longer pending');
    if (pending.questions) throw new Error('Question requires answers, not an approval');
    if (optionId !== 'allow' && optionId !== 'deny') throw new Error('Unknown approval option');
    session.queue.push([{ kind: 'approval_decision', request: requestId, option: optionId }]);
    pending.finish(optionId === 'allow' ? { behavior: 'allow', updatedInput: pending.input } : { behavior: 'deny', message: 'Denied by user' });
  }
  async answerQuestion(handle: Handle, requestId: string, answers: Record<string, string>): Promise<void> {
    const session = this.get(handle);
    const pending = session.approvals.get(requestId);
    if (!pending?.questions) throw new Error('Question is no longer pending');
    if (Object.keys(answers).length !== pending.questions.length || pending.questions.some((question) => !Object.hasOwn(answers, question) || typeof answers[question] !== 'string' || !answers[question]!.trim())) {
      throw new Error('Provide one non-empty answer for every question');
    }
    session.queue.push([{ kind: 'question_answer', request: requestId, answers }]);
    pending.finish({ behavior: 'allow', updatedInput: { ...pending.input, answers } });
  }
  /** Mid-turn: the message joins the running turn's input stream. While idle it
   *  is queued (visibly at the daemon) and flushed ahead of the next prompt. */
  async steer(handle: Handle, input: PromptInput): Promise<void> {
    const session = this.get(handle);
    if (!input.text) throw new Error('steer must not be empty');
    if (session.active && session.inputs) session.inputs.push(input.text);
    else session.steerBacklog.push(input.text);
  }
  async setModel(handle: Handle, model: string): Promise<void> {
    const session = this.get(handle);
    session.spec.model = model;
    await session.stream?.setModel?.(model);
    session.queue.push([{ kind: 'model_changed', model }]);
  }
  async setEffort(handle: Handle, effort: string): Promise<void> {
    const session = this.get(handle);
    if (!efforts.has(effort)) throw new Error('Unsupported Claude effort');
    session.spec.effort = effort; // applied to the next turn's options
    session.queue.push([{ kind: 'effort_changed', effort }]);
  }
  async setMode(handle: Handle, mode: string): Promise<void> {
    const session = this.get(handle);
    if (!modes.has(mode)) throw new Error('Unsupported or unsafe Claude permission mode');
    session.spec.mode = mode;
    await session.stream?.setPermissionMode?.(mode as NonNullable<Options['permissionMode']>);
    session.queue.push([{ kind: 'mode_changed', mode }]);
  }
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active || !session.abort) throw new Error('Claude session has no active turn');
    session.abort.abort();
    for (const pending of session.approvals.values()) pending.finish({ behavior: 'deny', message: 'Turn interrupted', interrupt: true }, 'cancelled');
    session.stream?.close?.();
    await session.running;
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
  async commands(handle: Handle): Promise<AgentCommand[]> {
    const session = this.get(handle);
    if (session.commandsQuery) {
      try {
        const commands = await withTimeout(session.commandsQuery.supportedCommands(), 5000);
        session.commands = commands.map(command => ({ name: command.name, description: command.description, source: 'agent' }));
      } catch { /* keep the last discovered commands */ }
    }
    return session.commands;
  }
  async dispose(handle: Handle): Promise<void> {
    const session = this.sessions.get(handle);
    if (!session) return;
    session.disposed = true;
    session.abort?.abort();
    session.stream?.close?.();
    for (const pending of session.approvals.values()) pending.finish({ behavior: 'deny', message: 'Session disposed', interrupt: true });
    await session.running;
    session.queue.close();
    this.sessions.delete(handle);
  }
  private get(handle: Handle): Session {
    const session = this.sessions.get(handle);
    if (!session || session.disposed) throw new Error('Unknown or disposed Claude session');
    return session;
  }
}
