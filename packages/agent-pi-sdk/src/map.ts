import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const base = z.looseObject({ type: z.string() });
const assistant = z.looseObject({ type: z.string(), delta: z.optional(z.string()) });
const update = z.looseObject({ assistantMessageEvent: assistant });
const toolStart = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), toolName: z.string().check(z.minLength(1)), args: z.optional(z.json()) });
const toolEnd = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), result: z.optional(z.json()), isError: z.optional(z.boolean()) });
const settled = z.looseObject({ aborted: z.optional(z.boolean()) });
const retry = z.looseObject({ attempt: z.number().check(z.int()), delayMs: z.optional(z.number()), success: z.optional(z.boolean()), finalError: z.optional(z.string()) });
const compaction = z.looseObject({ aborted: z.optional(z.boolean()), errorMessage: z.optional(z.string()) });
const thinkingLevel = z.looseObject({ level: z.string().check(z.minLength(1)) });

/** Maps pi `AgentSessionEvent` values for one prompt. Usage arrives in `message_update` snapshots on the assistant message. */
export class PiSdkMapper {
  private text = '';
  private thinking = '';
  private settled = false;
  private aborted = false;
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  private lastUsage?: AgentEvent;
  map(input: unknown): { events: AgentEvent[]; terminal?: boolean; aborted?: boolean } {
    const message = z.parse(base, input);
    const events: unknown[] = [];
    if (this.settled) throw new Error('pi event after agent_settled');
    if (message.type === 'message_update') {
      const value = z.parse(update, message);
      const usage = this.usage((message as { message?: { usage?: unknown } }).message?.usage);
      if (usage) this.lastUsage = usage;
      const sub = value.assistantMessageEvent;
      if (sub.type === 'text_delta' && typeof sub.delta === 'string') { this.text += sub.delta; events.push({ kind: 'text_delta', text: sub.delta }); }
      else if (sub.type === 'thinking_delta' && typeof sub.delta === 'string') { this.thinking += sub.delta; events.push({ kind: 'thinking_delta', text: sub.delta }); }
    } else if (message.type === 'tool_execution_start') {
      const value = z.parse(toolStart, message);
      if (!this.finished.has(value.toolCallId) && !this.calls.has(value.toolCallId)) {
        this.calls.add(value.toolCallId);
        events.push({ kind: 'tool_call', callId: value.toolCallId, name: value.toolName, input: value.args ?? null });
      }
    } else if (message.type === 'tool_execution_end') {
      const value = z.parse(toolEnd, message);
      if (!this.finished.has(value.toolCallId)) {
        this.calls.delete(value.toolCallId); this.finished.add(value.toolCallId);
        events.push({ kind: 'tool_result', callId: value.toolCallId, status: value.isError ? 'failed' : 'completed', ...(value.result !== undefined ? { output: value.result } : {}) });
      }
    } else if (message.type === 'turn_end') {
      if (this.lastUsage) { events.push(this.lastUsage); this.lastUsage = undefined; }
    } else if (message.type === 'auto_retry_start') {
      const value = z.parse(retry, message);
      events.push({ kind: 'rate_limited', attempt: value.attempt });
      if (value.delayMs !== undefined) events.push({ kind: 'retry_scheduled', delayMs: Math.max(0, Math.round(value.delayMs)) });
    } else if (message.type === 'auto_retry_end' && (message as { success?: boolean }).success === false) {
      const value = z.parse(retry, message);
      events.push({ kind: 'error', code: 'unknown', message: value.finalError ?? 'pi retry failed' });
    } else if (message.type === 'compaction_end') {
      const value = z.parse(compaction, message);
      if (value.errorMessage) events.push({ kind: 'error', code: 'unknown', message: value.errorMessage });
      else if (!value.aborted) events.push({ kind: 'compacted' });
    } else if (message.type === 'thinking_level_changed') {
      const value = z.parse(thinkingLevel, message);
      events.push({ kind: 'effort_changed', effort: value.level });
    } else if (message.type === 'agent_settled') {
      const value = z.parse(settled, message);
      this.settled = true; this.aborted = value.aborted === true;
      events.push(...this.finish());
      if (this.lastUsage) { events.push(this.lastUsage); this.lastUsage = undefined; }
    }
    return { events: events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid pi SDK event'); return parsed.data; }), ...(this.settled ? { terminal: true, aborted: this.aborted } : {}) };
  }
  /** Emit retained text and close tool calls that never finished. */
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    this.thinking = ''; this.text = '';
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear();
    return events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid pi SDK event'); return parsed.data; });
  }
  private usage(value: unknown): AgentEvent | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const usage = value as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
    const body = { kind: 'usage' as const, ...(usage.input !== undefined ? { input: usage.input } : {}), ...(usage.output !== undefined ? { output: usage.output } : {}), ...(usage.cacheRead !== undefined ? { cacheRead: usage.cacheRead } : {}), ...(usage.cacheWrite !== undefined ? { cacheWrite: usage.cacheWrite } : {}), ...(usage.cost?.total !== undefined ? { costUsd: usage.cost.total } : {}) };
    return Object.keys(body).length > 1 ? (body as AgentEvent) : undefined;
  }
}
