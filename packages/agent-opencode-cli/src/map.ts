import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const base = z.looseObject({ type: z.string(), sessionID: z.string().check(z.minLength(1)) });
const text = z.looseObject({ part: z.looseObject({ type: z.literal('text'), text: z.string() }) });
const tool = z.looseObject({ part: z.looseObject({ type: z.literal('tool'), id: z.string().check(z.minLength(1)), tool: z.string().check(z.minLength(1)), state: z.looseObject({ status: z.string(), input: z.optional(z.json()), output: z.optional(z.json()), error: z.optional(z.string()) }) }) });
const finish = z.looseObject({ part: z.looseObject({ type: z.literal('step-finish'), reason: z.string().check(z.minLength(1)), cost: z.optional(z.number()), tokens: z.optional(z.looseObject({ input: z.optional(z.number()), output: z.optional(z.number()), cache: z.optional(z.looseObject({ read: z.optional(z.number()), write: z.optional(z.number()) })) })) }) });

/** Maps `opencode run --format json` events. Usage is reported per finished step. */
export class OpenCodeCliMapper {
  private text = '';
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  map(input: unknown): { events: AgentEvent[]; nativeId?: string; stopReason?: string } {
    const message = z.parse(base, input);
    const events: unknown[] = [];
    let stopReason: string | undefined;
    if (message.type === 'text') {
      const value = z.parse(text, message).part.text;
      this.text += value; events.push({ kind: 'text_delta', text: value });
    } else if (message.type === 'tool_use') {
      const value = z.parse(tool, message).part;
      if (this.finished.has(value.id)) return { events: [] };
      if (!this.calls.has(value.id)) {
        this.calls.add(value.id);
        events.push({ kind: 'tool_call', callId: value.id, name: value.tool, input: value.state.input ?? null });
      }
      if (value.state.status === 'completed' || value.state.status === 'error') {
        this.calls.delete(value.id); this.finished.add(value.id);
        events.push({ kind: 'tool_result', callId: value.id, status: value.state.status === 'error' ? 'failed' : 'completed', ...(value.state.output !== undefined ? { output: value.state.output } : value.state.error !== undefined ? { output: value.state.error } : {}) });
      }
    } else if (message.type === 'step_finish') {
      const value = z.parse(finish, message).part; stopReason = value.reason;
      if (value.tokens || value.cost !== undefined) events.push({ kind: 'usage', ...(value.tokens?.input !== undefined ? { input: value.tokens.input } : {}), ...(value.tokens?.output !== undefined ? { output: value.tokens.output } : {}), ...(value.tokens?.cache?.read !== undefined ? { cacheRead: value.tokens.cache.read } : {}), ...(value.tokens?.cache?.write !== undefined ? { cacheWrite: value.tokens.cache.write } : {}), ...(value.cost !== undefined ? { costUsd: value.cost } : {}) });
    }
    return { events: events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid OpenCode CLI event'); return parsed.data; }), nativeId: message.sessionID, ...(stopReason ? { stopReason } : {}) };
  }
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.text) events.push({ kind: 'text', text: this.text });
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear();
    return events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid OpenCode CLI event'); return parsed.data; });
  }
}
