import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, Options, PermissionResult, Query } from '@anthropic-ai/claude-agent-sdk';
import { EventQueue, NO_CAPABILITIES } from '@ormicode/agent-core';
import type { AgentAdapter, Handle, NativeRef, PromptInput, StartSpec } from '@ormicode/agent-core';
import { monotonicFactory } from 'ulid';
import { parseEventBody } from '@ormicode/protocol';
import { mapSdkMessage } from './map.ts';

type QueryFactory = (params: { prompt: string; options?: Options }) => Query;
interface PendingApproval { finish: (result: PermissionResult) => void; input: Record<string, unknown>; questions?: string[] }
interface Session {
  spec: StartSpec;
  queue: EventQueue;
  nativeId?: string;
  active: boolean;
  disposed: boolean;
  abort?: AbortController;
  running?: Promise<void>;
  stream?: Query;
  needsResumeId: boolean;
  approvals: Map<string, PendingApproval>;
}
const makeId = monotonicFactory();
const modes = new Set(['default', 'acceptEdits', 'plan', 'dontAsk']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** One SDK query per turn; native session IDs reconnect subsequent queries. */
export class ClaudeSdkAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly transport = 'sdk' as const;
  // Capabilities stay conservative until exercised against a real authenticated SDK session.
  readonly capabilities = NO_CAPABILITIES;
  private sessions = new Map<Handle, Session>();
  private readonly options: { query?: QueryFactory; onNativeId?: (handle: Handle, nativeId: string) => void };
  constructor(options: { query?: QueryFactory; onNativeId?: (handle: Handle, nativeId: string) => void } = {}) { this.options = options; }
  async detect() { return { available: true, reason: 'SDK package available; authentication not checked' }; }
  async models() { return []; }
  async start(spec: StartSpec): Promise<Handle> { return this.create(spec); }
  async resume(ref: NativeRef): Promise<Handle> { return this.create({ cwd: ref.cwd }, ref.id); }
  private create(spec: StartSpec, nativeId?: string): Handle {
    if (!spec.cwd) throw new Error('cwd is required');
    if (spec.mode && !modes.has(spec.mode)) throw new Error('Unsupported or unsafe Claude permission mode');
    if (spec.effort && !efforts.has(spec.effort)) throw new Error('Unsupported Claude effort');
    const handle = Object.freeze({ id: `claude-${makeId()}` });
    this.sessions.set(handle, { spec, nativeId, queue: new EventQueue(), active: false, disposed: false, needsResumeId: false, approvals: new Map() });
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
        session.queue.push([{ kind: 'approval_request', request, options, tool: name, input, toolUseId: context.toolUseID, ...(context.title ? { title: context.title } : {}), ...(context.description ? { description: context.description } : {}), ...(context.decisionReason ? { decisionReason: context.decisionReason } : {}), ...(context.blockedPath ? { blockedPath: context.blockedPath } : {}) }]);
        }
        return new Promise<PermissionResult>((resolve) => {
          const onAbort = () => finish({ behavior: 'deny', message: 'Approval interrupted', interrupt: true });
          const finish = (result: PermissionResult) => {
            context.signal.removeEventListener('abort', onAbort);
            session.approvals.delete(request);
            resolve(result);
          };
          session.approvals.set(request, { finish, input, questions });
          if (context.signal.aborted) onAbort();
          else context.signal.addEventListener('abort', onAbort, { once: true });
        });
      };
      const options: Options = {
        cwd: session.spec.cwd, abortController: abort, includePartialMessages: true,
        settingSources: ['user', 'project', 'local'], tools: { type: 'preset', preset: 'claude_code' },
        permissionMode: (session.spec.mode ?? 'default') as Options['permissionMode'], canUseTool: permission,
        ...(session.spec.model ? { model: session.spec.model } : {}),
        ...(session.spec.effort ? { effort: session.spec.effort as Options['effort'] } : {}),
        ...(session.nativeId ? { resume: session.nativeId } : {}),
      };
      const stream = (this.options.query ?? query)({ prompt, options });
      session.stream = stream;
      for await (const message of stream) {
        if (session.disposed || abort.signal.aborted) break;
        const mapped = mapSdkMessage(message);
        if (mapped.nativeId) {
          this.options.onNativeId?.(handle, mapped.nativeId);
          session.nativeId = mapped.nativeId;
        }
        if (message.type === 'result') completed = true;
        const events = mapped.events.filter((event) => event.kind !== 'turn_end');
        if (events.length) session.queue.push(events);
      }
      if (!completed && !session.disposed) session.queue.push([{ kind: 'interrupted', reason: abort.signal.aborted ? 'user_abort' : 'sdk_stream_ended' }]);
    } catch (error) {
      if (!session.disposed) {
        const reason = abort.signal.aborted ? 'user_abort' : 'sdk_error';
        try { session.queue.push([{ kind: 'interrupted', reason }, ...(abort.signal.aborted ? [] : [{ kind: 'error' as const, code: 'unknown', message: error instanceof Error ? error.message : 'Claude SDK failed' }])]); }
        catch { session.queue.close(); }
      }
    } finally {
      for (const pending of session.approvals.values()) pending.finish({ behavior: 'deny', message: 'Session ended', interrupt: true });
      session.active = false;
      session.abort = undefined;
      session.stream = undefined;
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
  async interrupt(handle: Handle): Promise<void> {
    const session = this.get(handle);
    if (!session.active || !session.abort) throw new Error('Claude session has no active turn');
    session.abort.abort();
    for (const pending of session.approvals.values()) pending.finish({ behavior: 'deny', message: 'Turn interrupted', interrupt: true });
    session.stream?.close?.();
    await session.running;
  }
  events(handle: Handle) { return this.get(handle).queue.subscribe(); }
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
