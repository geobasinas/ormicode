import * as z from 'zod/mini';
import { ulid } from 'ulid';
import type { AgentEvent } from '@ormicode/protocol';

const requestSchema = z.looseObject({ sessionId: z.string(), toolCall: z.looseObject({ toolCallId: z.string() }), options: z.array(z.looseObject({ optionId: z.string().check(z.minLength(1)), name: z.string(), kind: z.string() })) });
type Pending = { ids: Set<string>; resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> };
const cancelled = { outcome: { outcome: 'cancelled' } };

/** Only the exact option selected by the owner is sent to Vibe. */
export class VibePermissionBroker {
  private pending = new Map<string, Pending>();
  private readonly emit: (event: AgentEvent) => void;
  constructor(emit: (event: AgentEvent) => void) { this.emit = emit; }
  request(input: unknown, sessionId: string): Promise<unknown> {
    const parsed = z.safeParse(requestSchema, input);
    if (!parsed.success || parsed.data.sessionId !== sessionId || this.pending.size >= 64) return Promise.resolve(cancelled);
    const ids = parsed.data.options.map(option => option.optionId);
    if (!ids.length || new Set(ids).size !== ids.length) return Promise.resolve(cancelled);
    const request = `req_${ulid()}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => this.expire(request, 'timeout'), 300_000);
      this.pending.set(request, { ids: new Set(ids), resolve, timer });
      try { this.emit({ kind: 'approval_request', request, options: parsed.data.options.map(option => ({ id: option.optionId, label: option.name, kind: option.kind })), toolCall: parsed.data.toolCall }); }
      catch { clearTimeout(timer); this.pending.delete(request); resolve(cancelled); }
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
