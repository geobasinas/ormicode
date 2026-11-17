import * as z from 'zod/mini';
import { ulid } from 'ulid';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@ormicode/protocol';
import { classifyCommand, loadDestructivePatterns, type DestructivePattern } from '@ormicode/agent-core';

const option = z.looseObject({ optionId: z.string().check(z.minLength(1)), name: z.string(), kind: z.optional(z.string()) });
const requestSchema = z.looseObject({
  sessionId: z.string(),
  toolCall: z.optional(z.looseObject({ toolCallId: z.optional(z.string()), title: z.optional(z.nullable(z.string())), rawInput: z.optional(z.looseObject({ command: z.optional(z.string()) })) })),
  title: z.optional(z.string()), description: z.optional(z.string()), subject: z.optional(z.json()),
  options: z.array(option),
});
type Pending = { ids: Set<string>; resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> };
const cancelled = { outcome: { outcome: 'cancelled' } };

let patterns: readonly DestructivePattern[] | undefined;
const destructive = (command: string | undefined) => {
  if (!command) return undefined;
  if (!patterns) patterns = loadDestructivePatterns(join(process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode'), 'destructive.json'));
  return classifyCommand(command, patterns);
};

/** v1 requests carry a toolCall; v2 carry title/description/subject. Only the exact selected option is answered. */
export class AcpPermissionBroker {
  private pending = new Map<string, Pending>();
  private readonly emit: (event: AgentEvent) => void;
  constructor(emit: (event: AgentEvent) => void) { this.emit = emit; }
  request(input: unknown, sessionId: string): Promise<unknown> {
    const parsed = z.safeParse(requestSchema, input);
    if (!parsed.success || parsed.data.sessionId !== sessionId || this.pending.size >= 64) return Promise.resolve(cancelled);
    const ids = parsed.data.options.map(entry => entry.optionId);
    if (!ids.length || new Set(ids).size !== ids.length) return Promise.resolve(cancelled);
    const request = `req_${ulid()}`;
    const hit = destructive(parsed.data.toolCall?.rawInput?.command);
    const detail = {
      ...(parsed.data.toolCall?.toolCallId
        ? { toolCall: parsed.data.toolCall }
        : { ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}), ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}), ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}) }),
      ...(hit ? { destructive: true, rule: hit.rule } : {}),
    };
    return new Promise(resolve => {
      const timer = setTimeout(() => this.expire(request, 'timeout'), 300_000);
      this.pending.set(request, { ids: new Set(ids), resolve, timer });
      try {
        this.emit({ kind: 'approval_request', request, options: parsed.data.options.map(entry => ({ id: entry.optionId, label: entry.name, ...(entry.kind !== undefined ? { kind: entry.kind } : {}) })), ...detail });
      } catch { clearTimeout(timer); this.pending.delete(request); resolve(cancelled); }
    });
  }
  decide(request: string, option: string): void {
    const pending = this.pending.get(request);
    if (!pending || !pending.ids.has(option)) throw new Error('Unknown approval request or option');
    this.emit({ kind: 'approval_decision', request, option });
    clearTimeout(pending.timer); this.pending.delete(request);
    pending.resolve({ outcome: { outcome: 'selected', optionId: option } });
  }
  expireAll(reason: string): void { for (const request of this.pending.keys()) this.expire(request, reason); }
  private expire(request: string, reason: string): void {
    const pending = this.pending.get(request); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(request);
    try { this.emit({ kind: 'interaction_expired', request, reason }); } catch { /* Resolve even if delivery fails. */ }
    pending.resolve(cancelled);
  }
}
