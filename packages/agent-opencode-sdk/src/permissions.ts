import * as z from 'zod/mini';
import { ulid } from 'ulid';
import type { AgentEvent } from '@ormicode/protocol';
import type { OpenCodeClient } from '@opencode/client';

const asked = z.looseObject({ id: z.string().check(z.minLength(1)), sessionID: z.string().check(z.minLength(1)), action: z.optional(z.string()), message: z.optional(z.string()), resources: z.optional(z.array(z.string())) });
type Pending = { sessionID: string; permissionID: string; timer: ReturnType<typeof setTimeout> };
const options = [
  { id: 'once', label: 'Allow once' },
  { id: 'always', label: 'Always allow' },
  { id: 'reject', label: 'Reject' },
];

/** Permission decisions go to OpenCode verbatim; only the exact option selected by the owner is sent. */
export class OpenCodePermissionBroker {
  private pending = new Map<string, Pending>();
  private readonly emit: (event: AgentEvent) => void;
  private readonly reply: (sessionID: string, requestID: string, decision: 'once' | 'always' | 'reject') => Promise<void>;
  constructor(emit: (event: AgentEvent) => void, reply: (sessionID: string, requestID: string, decision: 'once' | 'always' | 'reject') => Promise<void>) { this.emit = emit; this.reply = reply; }
  static create(emit: (event: AgentEvent) => void, client: OpenCodeClient): OpenCodePermissionBroker {
    return new OpenCodePermissionBroker(emit, (sessionID, requestID, decision) => client.permission.reply({ sessionID, requestID, decision }));
  }
  asked(input: unknown): void {
    const parsed = z.safeParse(asked, input);
    if (!parsed.success || this.pending.size >= 64) return;
    const request = `req_${ulid()}`;
    const timer = setTimeout(() => this.expire(request, 'timeout'), 300_000);
    this.pending.set(request, { sessionID: parsed.data.sessionID, permissionID: parsed.data.id, timer });
    try { this.emit({ kind: 'approval_request', request, options: options.map(option => ({ id: option.id, label: option.label })) }); }
    catch { clearTimeout(timer); this.pending.delete(request); }
  }
  decide(request: string, option: string): void {
    const pending = this.pending.get(request);
    if (!pending || !options.some(entry => entry.id === option)) throw new Error('Unknown approval request or option');
    this.emit({ kind: 'approval_decision', request, option });
    clearTimeout(pending.timer); this.pending.delete(request);
    void this.reply(pending.sessionID, pending.permissionID, option as 'once' | 'always' | 'reject').catch(() => { });
  }
  expireAll(reason: string): void { for (const request of this.pending.keys()) this.expire(request, reason); }
  private expire(request: string, reason: string): void {
    const pending = this.pending.get(request); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(request);
    try { this.emit({ kind: 'interaction_expired', request, reason }); } catch { /* Still reject server-side. */ }
    void this.reply(pending.sessionID, pending.permissionID, 'reject').catch(() => { });
  }
}
