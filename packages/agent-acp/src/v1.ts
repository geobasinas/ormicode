import * as z from 'zod/mini';
import type { AgentEvent } from '@ormicode/protocol';
import type { JsonRpcPeer } from './jsonrpc.ts';
import { envelope, mapUsage, parseModes, parseOptions, validateEvents } from './profile.ts';
import type { AcpProfile, SessionBootstrap, TurnMapper } from './profile.ts';

const chunk = z.looseObject({ content: z.looseObject({ type: z.string(), text: z.optional(z.string()) }) });
const tool = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), title: z.optional(z.nullable(z.string())), status: z.optional(z.nullable(z.string())), rawInput: z.optional(z.json()), rawOutput: z.optional(z.json()) });
const sessionNew = z.looseObject({ sessionId: z.string().check(z.minLength(1)), modes: z.optional(z.json()), configOptions: z.optional(z.json()) });
const initResult = z.looseObject({ protocolVersion: z.literal(1), agentCapabilities: z.optional(z.looseObject({ loadSession: z.optional(z.boolean()) })), agentInfo: z.optional(z.looseObject({ name: z.optional(z.string()), version: z.optional(z.string()) })) });
const promptResult = z.looseObject({ stopReason: z.string().check(z.minLength(1)) });

class V1TurnMapper implements TurnMapper {
  private text = '';
  private thinking = '';
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly sessionId: string;
  constructor(sessionId: string) { this.sessionId = sessionId; }
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
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const data = z.parse(tool, update);
      if (this.finished.has(data.toolCallId)) return [];
      if (!this.calls.has(data.toolCallId)) {
        this.calls.add(data.toolCallId);
        events.push({ kind: 'tool_call', callId: data.toolCallId, name: data.title || 'Agent tool', input: data.rawInput ?? null });
      }
      if (data.status === 'completed' || data.status === 'failed') {
        this.calls.delete(data.toolCallId); this.finished.add(data.toolCallId);
        events.push({ kind: 'tool_result', callId: data.toolCallId, status: data.status, ...(data.rawOutput !== undefined ? { output: data.rawOutput } : {}) });
      }
    } else if (update.sessionUpdate === 'usage_update') events.push(...mapUsage(update));
    else if (update.sessionUpdate === 'current_mode_update') {
      const data = z.parse(z.looseObject({ currentModeId: z.string() }), update);
      events.push({ kind: 'mode_changed', mode: data.currentModeId });
    } else if (update.sessionUpdate === 'config_option_update') {
      const data = z.parse(z.looseObject({ configOption: z.optional(z.looseObject({ configId: z.optional(z.string()), id: z.optional(z.string()), currentValue: z.optional(z.union([z.string(), z.boolean()])) })) }), update);
      const option = data.configOption; const id = option?.configId ?? option?.id;
      if (id && option?.currentValue !== undefined) events.push({ kind: 'config_option', id, value: option.currentValue });
    }
    return validateEvents(events, 'ACP v1');
  }
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear(); this.thinking = ''; this.text = '';
    return validateEvents(events, 'ACP v1');
  }
}

/** ACP v1: prompt response ends the turn; session/load for resume; modes via session/set_mode or config options. */
export function createV1Profile(): AcpProfile {
  let loadSession = false;
  return {
    version: 1,
    initializeParams: () => ({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'ormicode', version: '0.0.0' } }),
    parseInitialize(result) {
      const parsed = z.parse(initResult, result);
      loadSession = parsed.agentCapabilities?.loadSession === true;
      return { loadSession, info: parsed.agentInfo ?? {} };
    },
    async newSession(peer, cwd, mcpServers = []) {
      const parsed = z.parse(sessionNew, await peer.request('session/new', { cwd, mcpServers }));
      const { modes, currentMode } = parseModes(parsed.modes);
      return { nativeId: parsed.sessionId, options: parseOptions(parsed.configOptions), modes, ...(currentMode !== undefined ? { currentMode } : {}) };
    },
    async resumeSession(peer, nativeId, cwd, mcpServers = []) {
      if (!loadSession) throw new Error('Agent did not advertise session loading');
      const parsed = z.parse(sessionNew, await peer.request('session/load', { sessionId: nativeId, cwd, mcpServers }));
      const { modes, currentMode } = parseModes(parsed.modes);
      return { nativeId, options: parseOptions(parsed.configOptions), modes, ...(currentMode !== undefined ? { currentMode } : {}) };
    },
    async sendPrompt(peer, sessionId, text) {
      const parsed = z.parse(promptResult, await peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 300_000));
      return parsed.stopReason;
    },
    cancel(peer, sessionId) { peer.notify('session/cancel', { sessionId }); },
    async setConfigOption(peer, sessionId, option, value) {
      const result = await peer.request('session/set_config_option', { sessionId, configId: option.id, value });
      const parsed = z.safeParse(z.looseObject({ configOptions: z.optional(z.json()) }), result);
      return parseOptions(parsed.success ? parsed.data.configOptions : undefined);
    },
    async setMode(peer, sessionId, modeId) { await peer.request('session/set_mode', { sessionId, modeId }); },
    createMapper(sessionId) { return new V1TurnMapper(sessionId); },
  };
}
export type { SessionBootstrap };
