import * as z from 'zod/mini';
import { monotonicFactory } from 'ulid';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

type Decision = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string };
type Pending = { input: Record<string, unknown>; questions?: string[]; finish: (decision: Decision) => void };
const makeId = monotonicFactory();

/** In-process decision coordinator. This does not expose or start an MCP server. */
export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  private readonly emit: (event: AgentEvent) => void;
  constructor(emit: (event: AgentEvent) => void) { this.emit = emit; }

  request(tool: string, input: unknown, signal?: AbortSignal, toolUseId?: string): Promise<Decision> {
    const deny = (message: string): Promise<Decision> => Promise.resolve({ behavior: 'deny', message });
    if (this.closed || signal?.aborted) return deny('Permission request cancelled');
    if (!tool.trim() || this.pending.size >= 64) return deny('Permission request unavailable');
    const json = z.safeParse(z.record(z.string(), z.json()), input);
    if (!json.success) return deny('Invalid permission input');
    const request = `req_${makeId()}`;
    let questions: string[] | undefined;
    let candidate: unknown;
    if (tool === 'AskUserQuestion') {
      candidate = { kind: 'question_request', request, questions: json.data.questions };
      const parsed = parseEventBody(candidate);
      if (!parsed.success || parsed.data.kind !== 'question_request' || !parsed.data.questions.length) return deny('Invalid question request');
      questions = parsed.data.questions.map((item) => item.question);
      if (new Set(questions).size !== questions.length) return deny('Ambiguous question request');
      candidate = parsed.data;
    } else {
      candidate = { kind: 'approval_request', request, tool, input: json.data, ...(toolUseId ? { toolUseId } : {}), options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] };
    }
    const event = parseEventBody(candidate);
    if (!event.success) return deny('Invalid permission request');
    return new Promise<Decision>((resolve) => {
      const onAbort = () => {
        try { this.emit({ kind: 'interaction_expired', request, reason: 'cancelled' }); } catch { /* Denial must still resolve. */ }
        finish({ behavior: 'deny', message: 'Permission request cancelled' });
      };
      const finish = (decision: Decision) => { signal?.removeEventListener('abort', onAbort); this.pending.delete(request); resolve(decision); };
      this.pending.set(request, { input: json.data, questions, finish });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted || this.closed) { onAbort(); return; }
      try { this.emit(event.data); } catch { finish({ behavior: 'deny', message: 'Permission request could not be delivered' }); }
    });
  }
  decide(request: string, option: string): void {
    const pending = this.pending.get(request);
    if (!pending || pending.questions) throw new Error('Approval is not pending');
    if (option !== 'allow' && option !== 'deny') throw new Error('Unknown approval option');
    this.emit({ kind: 'approval_decision', request, option });
    pending.finish(option === 'allow' ? { behavior: 'allow', updatedInput: pending.input } : { behavior: 'deny', message: 'Denied by user' });
  }
  answer(request: string, answers: Record<string, string>): void {
    const pending = this.pending.get(request);
    if (!pending?.questions) throw new Error('Question is not pending');
    if (Object.keys(answers).length !== pending.questions.length || pending.questions.some((question) => !Object.hasOwn(answers, question) || typeof answers[question] !== 'string' || !answers[question]!.trim())) throw new Error('Provide one non-empty answer for every question');
    this.emit({ kind: 'question_answer', request, answers });
    pending.finish({ behavior: 'allow', updatedInput: { ...pending.input, answers } });
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [request, pending] of this.pending) {
      try { this.emit({ kind: 'interaction_expired', request, reason: 'disposed' }); } catch { /* Continue denying all pending calls. */ }
      pending.finish({ behavior: 'deny', message: 'Permission broker disposed' });
    }
  }
}
