import * as z from 'zod/mini';
import type { AgentEvent } from '@ormicode/protocol';
import type { JsonRpcPeer } from './jsonrpc.ts';
import { envelope, mapUsage, parseOptions, validateEvents } from './profile.ts';
import type { AcpProfile, TurnMapper } from './profile.ts';

const chunk = z.looseObject({ content: z.looseObject({ type: z.string(), text: z.optional(z.string()) }), messageId: z.optional(z.string()) });
const whole = z.looseObject({ messageId: z.optional(z.string()), content: z.optional(z.array(z.looseObject({ type: z.string(), text: z.optional(z.string()) }))), message: z.optional(z.looseObject({ content: z.optional(z.array(z.looseObject({ type: z.string(), text: z.optional(z.string()) }))) })) });
const tool = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), title: z.optional(z.nullable(z.string())), status: z.optional(z.nullable(z.string())), rawInput: z.optional(z.json()), rawOutput: z.optional(z.json()) });
const stateUpdate = z.looseObject({ state: z.string(), stopReason: z.optional(z.string()), error: z.optional(z.json()) });
const sessionNew = z.looseObject({ sessionId: z.string().check(z.minLength(1)), configOptions: z.optional(z.json()) });
const initResult = z.looseObject({ protocolVersion: z.literal(2), capabilities: z.optional(z.json()), info: z.optional(z.looseObject({ name: z.optional(z.string()), version: z.optional(z.string()) })) });
const promptResult = z.looseObject({ messageId: z.string().check(z.minLength(1)) });

class V2TurnMapper implements TurnMapper {
  private text = '';
  private thinking = '';
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly messages = new Map<string, string>();
  private readonly thoughts = new Map<string, string>();
  private readonly sessionId: string;
  private readonly onTerminal: (stopReason: string) => void;
  constructor(sessionId: string, onTerminal: (stopReason: string) => void) { this.sessionId = sessionId; this.onTerminal = onTerminal; }
  update(input: unknown): AgentEvent[] {
    const message = z.parse(envelope, input);
    if (message.sessionId !== this.sessionId) throw new Error('Unexpected ACP session ID');
    const update = message.update;
    const events: unknown[] = [];
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
      const data = z.parse(chunk, update);
      if (data.content.type === 'text' && typeof data.content.text === 'string') {
        if (update.sessionUpdate === 'agent_message_chunk') { this.text += data.content.text; events.push({ kind: 'text_delta', text: data.content.text }); }
        else { this.thinking += data.content.text; events.push({ kind: 'thinking_delta', text: data.content.text }); }
      }
    } else if (update.sessionUpdate === 'agent_message' || update.sessionUpdate === 'agent_thought') {
      const data = z.parse(whole, update);
      const blocks = data.content ?? data.message?.content ?? [];
      const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
      if (text) {
        const seen = update.sessionUpdate === 'agent_message' ? this.messages : this.thoughts;
        const key = data.messageId ?? 'default';
        const delta = text.slice((seen.get(key) ?? '').length);
        seen.set(key, text);
        if (delta) {
          if (update.sessionUpdate === 'agent_message') { this.text += delta; events.push({ kind: 'text_delta', text: delta }); }
          else { this.thinking += delta; events.push({ kind: 'thinking_delta', text: delta }); }
        }
      }
    } else if (update.sessionUpdate === 'tool_call_update') {
      const data = z.parse(tool, update);
      if (!this.finished.has(data.toolCallId)) {
        if (!this.calls.has(data.toolCallId)) {
          this.calls.add(data.toolCallId);
          events.push({ kind: 'tool_call', callId: data.toolCallId, name: data.title || 'Agent tool', input: data.rawInput ?? null });
        }
        if (data.status === 'completed' || data.status === 'failed') {
          this.calls.delete(data.toolCallId); this.finished.add(data.toolCallId);
          events.push({ kind: 'tool_result', callId: data.toolCallId, status: data.status, ...(data.rawOutput !== undefined ? { output: data.rawOutput } : {}) });
        }
      }
    } else if (update.sessionUpdate === 'state_update') {
      const data = z.parse(stateUpdate, update);
      if (data.state === 'idle') this.onTerminal(data.stopReason ?? 'end_turn');
    } else if (update.sessionUpdate === 'usage_update') events.push(...mapUsage(update));
    else if (update.sessionUpdate === 'config_option_update') {
      const data = z.parse(z.looseObject({ configOption: z.optional(z.looseObject({ configId: z.optional(z.string()), currentValue: z.optional(z.union([z.string(), z.boolean()])) })) }), update);
      if (data.configOption?.configId && data.configOption.currentValue !== undefined) events.push({ kind: 'config_option', id: data.configOption.configId, value: data.configOption.currentValue });
    } else if (update.sessionUpdate === 'compaction_update') events.push({ kind: 'compacted' });
    return validateEvents(events, 'ACP v2');
  }
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear(); this.thinking = ''; this.text = '';
    return validateEvents(events, 'ACP v2');
  }
}

/** ACP v2 (draft): prompt response is only insertion; the turn ends on an idle state_update. Resume via session/resume; settings via session/set_config_option. */
export function createV2Profile(): AcpProfile {
  return {
    version: 2,
    initializeParams: () => ({ protocolVersion: 2, info: { name: 'ormicode', version: '0.0.0' }, capabilities: {} }),
    parseInitialize(result) {
      const parsed = z.parse(initResult, result);
      return { loadSession: true, info: parsed.info ?? {} };
    },
    async newSession(peer, cwd) {
      const parsed = z.parse(sessionNew, await peer.request('session/new', { cwd, mcpServers: [] }));
      return { nativeId: parsed.sessionId, options: parseOptions(parsed.configOptions), modes: [] };
    },
    async resumeSession(peer, nativeId, cwd) {
      const parsed = z.parse(sessionNew, await peer.request('session/resume', { sessionId: nativeId, cwd, mcpServers: [], replayFrom: { type: 'start' } }));
      return { nativeId: parsed.sessionId === nativeId ? nativeId : parsed.sessionId, options: parseOptions(parsed.configOptions), modes: [] };
    },
    async sendPrompt(peer, sessionId, text) {
      z.parse(promptResult, await peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 300_000));
      return undefined;
    },
    cancel(peer, sessionId) { peer.notify('session/cancel', { sessionId }); },
    async setConfigOption(peer, sessionId, option, value) {
      const type = typeof value === 'boolean' ? 'boolean' : 'id';
      const result = await peer.request('session/set_config_option', { sessionId, configId: option.id, type, value });
      const parsed = z.safeParse(z.looseObject({ configOptions: z.optional(z.json()) }), result);
      return parseOptions(parsed.success ? parsed.data.configOptions : undefined);
    },
    async setMode() { throw new Error('v2 uses config options, not session/set_mode'); },
    createMapper(sessionId, onTerminal) { return new V2TurnMapper(sessionId, onTerminal); },
  };
}
