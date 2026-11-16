import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const event = z.looseObject({ type: z.string(), data: z.looseObject({ sessionID: z.optional(z.string()) }) });
const sessionData = z.looseObject({ sessionID: z.string().check(z.minLength(1)) });
const textDelta = z.looseObject({ sessionID: z.string(), delta: z.string() });
const textEnded = z.looseObject({ sessionID: z.string(), text: z.string() });
const toolInput = z.looseObject({ sessionID: z.string(), id: z.string().check(z.minLength(1)), name: z.string().check(z.minLength(1)) });
const toolCalled = z.looseObject({ sessionID: z.string(), id: z.string().check(z.minLength(1)), input: z.json() });
const toolSuccess = z.looseObject({ sessionID: z.string(), id: z.string().check(z.minLength(1)), content: z.optional(z.json()), metadata: z.optional(z.json()) });
const toolFailed = z.looseObject({ sessionID: z.string(), id: z.string().check(z.minLength(1)), error: z.looseObject({ message: z.string() }), content: z.optional(z.json()) });
const usage = z.looseObject({ sessionID: z.string(), cost: z.optional(z.number()), tokens: z.optional(z.looseObject({ input: z.optional(z.number()), output: z.optional(z.number()), cache: z.optional(z.looseObject({ read: z.optional(z.number()), write: z.optional(z.number()) })) })) });
const structuredError = z.looseObject({ sessionID: z.string(), error: z.looseObject({ message: z.string() }) });
const retry = z.looseObject({ sessionID: z.string(), attempt: z.number().check(z.int()), at: z.number() });

export type OpenCodeEvent = { type: string; data?: { sessionID?: string } };

/** Maps OpenCode v2 server events for one session and one turn. */
export class OpenCodeEventMapper {
  private text = '';
  private thinking = '';
  private readonly names = new Map<string, string>();
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly sessionId: string;
  constructor(sessionId: string) { this.sessionId = sessionId; }
  map(input: unknown): AgentEvent[] {
    const message = z.parse(event, input);
    const events: unknown[] = [];
    if (message.data?.sessionID !== undefined && message.data.sessionID !== this.sessionId) return [];
    if (message.type === 'session.text.delta') {
      const value = z.parse(textDelta, message.data).delta;
      this.text += value; events.push({ kind: 'text_delta', text: value });
    } else if (message.type === 'session.text.ended') {
      const value = z.parse(textEnded, message.data).text;
      if (value && value !== this.text) events.push({ kind: 'text', text: value });
      else if (this.text) events.push({ kind: 'text', text: this.text });
      this.text = '';
    } else if (message.type === 'session.reasoning.delta') {
      const value = z.parse(textDelta, message.data).delta;
      this.thinking += value; events.push({ kind: 'thinking_delta', text: value });
    } else if (message.type === 'session.reasoning.ended') {
      const value = z.parse(textEnded, message.data).text;
      if (value && value !== this.thinking) events.push({ kind: 'thinking', text: value });
      else if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
      this.thinking = '';
    } else if (message.type === 'session.tool.input.started') {
      const value = z.parse(toolInput, message.data);
      this.names.set(value.id, value.name);
    } else if (message.type === 'session.tool.called') {
      const value = z.parse(toolCalled, message.data);
      if (!this.finished.has(value.id) && !this.calls.has(value.id)) {
        this.calls.add(value.id);
        events.push({ kind: 'tool_call', callId: value.id, name: this.names.get(value.id) ?? 'tool', input: value.input });
      }
    } else if (message.type === 'session.tool.success') {
      const value = z.parse(toolSuccess, message.data);
      if (!this.finished.has(value.id)) {
        this.calls.delete(value.id); this.finished.add(value.id);
        events.push({ kind: 'tool_result', callId: value.id, status: 'completed', ...(value.content !== undefined ? { output: value.content } : value.metadata !== undefined ? { output: value.metadata } : {}) });
      }
    } else if (message.type === 'session.tool.failed') {
      const value = z.parse(toolFailed, message.data);
      if (!this.finished.has(value.id)) {
        this.calls.delete(value.id); this.finished.add(value.id);
        events.push({ kind: 'tool_result', callId: value.id, status: 'failed', output: value.error.message });
      }
    } else if (message.type === 'session.usage.updated') {
      const value = z.parse(usage, message.data);
      events.push({ kind: 'usage', ...(value.tokens?.input !== undefined ? { input: value.tokens.input } : {}), ...(value.tokens?.output !== undefined ? { output: value.tokens.output } : {}), ...(value.tokens?.cache?.read !== undefined ? { cacheRead: value.tokens.cache.read } : {}), ...(value.tokens?.cache?.write !== undefined ? { cacheWrite: value.tokens.cache.write } : {}), ...(value.cost !== undefined ? { costUsd: value.cost } : {}) });
    } else if (message.type === 'session.retry.scheduled') {
      const value = z.parse(retry, message.data);
      events.push({ kind: 'retry_scheduled', delayMs: Math.max(0, Math.round(value.at - Date.now())) });
      events.push({ kind: 'rate_limited', attempt: value.attempt });
    } else if (message.type === 'session.step.failed' || message.type === 'session.execution.failed') {
      const value = z.parse(structuredError, message.data);
      events.push({ kind: 'error', code: 'unknown', message: value.error.message });
    }
    return this.validate(events);
  }
  /** Emit retained text and close tool calls that never finished. */
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear(); this.text = ''; this.thinking = '';
    return this.validate(events);
  }
  private validate(events: unknown[]): AgentEvent[] {
    return events.map(item => { const parsed = parseEventBody(item); if (!parsed.success) throw new Error('Invalid OpenCode event'); return parsed.data; });
  }
}
