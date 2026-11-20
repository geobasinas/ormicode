import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSession } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

export interface McpProof { session: string; token: string }

export class McpCredentials {
  private readonly active = new Map<string, string>();
  private readonly issued = new Set<string>();

  issue(session: string): string {
    const token = randomBytes(32).toString('hex');
    this.active.set(session, token); this.issued.add(token);
    return token;
  }
  verify(proof: unknown): proof is McpProof {
    if (!proof || typeof proof !== 'object') return false;
    const { session, token } = proof as Partial<McpProof>;
    if (typeof session !== 'string' || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
    const expected = this.active.get(session);
    return timingSafeEqual(Buffer.from(expected ?? '0'.repeat(64), 'hex'), Buffer.from(token, 'hex')) && expected !== undefined;
  }
  revoke(session: string, token?: string): void {
    if (token === undefined || this.active.get(session) === token) this.active.delete(session);
  }
  activeFor(session: string): boolean { return this.active.has(session); }
  clear(): void { this.active.clear(); this.issued.clear(); }
  redact<T>(value: T): T {
    if (typeof value === 'string') {
      let result: string = value;
      for (const token of this.issued) result = result.replaceAll(token, '[REDACTED MCP TOKEN]');
      return result as T;
    }
    if (Array.isArray(value)) return value.map(item => this.redact(item)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.redact(key), this.redact(item)])) as T;
    return value;
  }
}

export function authorizeMcp(ctx: DispatchCtx, method: string, body: Record<string, unknown>, proof: unknown): string | undefined {
  const required = method.startsWith('team.') || method === 'session.askUser' || (method === 'session.start' && body.parent !== undefined)
    || (method === 'session.handoff' && body.agentApproval === true);
  if (proof === undefined && !required) return undefined;
  if (!ctx.mcpCredentials.verify(proof)) return 'mcp.unauthorized';
  const self = proof.session;
  const session = getSession(ctx.db, self);
  if (!session || session.archived) return 'mcp.unauthorized';
  if (method.startsWith('team.')) return body.actor === self ? undefined : 'mcp.forbidden';
  if (method === 'session.start') return body.parent === self ? undefined : 'mcp.forbidden';
  const own = body.session === self;
  const child = typeof body.session === 'string' && getSession(ctx.db, body.session)?.parent === self;
  if (['session.prompt', 'session.subscribe', 'session.unsubscribe'].includes(method)) return own || child ? undefined : 'mcp.forbidden';
  if (['session.get', 'session.list'].includes(method)) return undefined;
  if (['session.askUser', 'session.handoff', 'session.getNotes', 'session.setNotes', 'preview.console'].includes(method) || method.startsWith('browser.') || method.startsWith('design.'))
    return own ? undefined : 'mcp.forbidden';
  return 'mcp.forbidden';
}
