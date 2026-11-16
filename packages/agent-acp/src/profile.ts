import * as z from 'zod/mini';
import type { AgentEvent } from '@ormicode/protocol';
import { parseEventBody } from '@ormicode/protocol';
import type { JsonRpcPeer } from './jsonrpc.ts';

export interface ConfigOption { id: string; category?: string; type?: string; name?: string; current?: string | boolean; choices: { value: string | boolean; name?: string }[] }
export interface Mode { id: string; name: string }
export interface SessionBootstrap { nativeId: string; options: ConfigOption[]; modes: Mode[]; currentMode?: string }
export interface TurnMapper { update(params: unknown): AgentEvent[]; finish(): AgentEvent[] }
export interface AgentInfo { name?: string; version?: string }

/** One protocol profile (v1 or v2). The adapter negotiates once, then delegates entirely to the profile. */
export interface AcpProfile {
  readonly version: 1 | 2;
  initializeParams(): unknown;
  parseInitialize(result: unknown): { loadSession: boolean; info: AgentInfo };
  newSession(peer: JsonRpcPeer, cwd: string): Promise<SessionBootstrap>;
  resumeSession(peer: JsonRpcPeer, nativeId: string, cwd: string): Promise<SessionBootstrap>;
  /** v1 resolves with the stopReason that ended the turn; v2 resolves on insertion and the turn ends via state_update. */
  sendPrompt(peer: JsonRpcPeer, sessionId: string, text: string): Promise<string | undefined>;
  cancel(peer: JsonRpcPeer, sessionId: string): void;
  setConfigOption(peer: JsonRpcPeer, sessionId: string, option: ConfigOption, value: string | boolean): Promise<ConfigOption[]>;
  setMode(peer: JsonRpcPeer, sessionId: string, modeId: string): Promise<void>;
  createMapper(sessionId: string, onTerminal: (stopReason: string) => void): TurnMapper;
}

const optionChoice = z.looseObject({ value: z.optional(z.union([z.string(), z.boolean()])), id: z.optional(z.string()), name: z.optional(z.string()) });
const configOption = z.looseObject({
  configId: z.optional(z.string()), id: z.optional(z.string()), category: z.optional(z.string()),
  type: z.optional(z.string()), name: z.optional(z.string()),
  currentValue: z.optional(z.union([z.string(), z.boolean()])), value: z.optional(z.union([z.string(), z.boolean()])),
  options: z.optional(z.array(optionChoice)),
});
const mode = z.looseObject({ id: z.optional(z.string()), modeId: z.optional(z.string()), name: z.optional(z.string()) });
const modes = z.looseObject({ currentModeId: z.optional(z.string()), availableModes: z.optional(z.array(mode)) });

export function parseOptions(input: unknown): ConfigOption[] {
  if (!Array.isArray(input)) return [];
  const parsed = z.safeParse(z.array(configOption), input);
  if (!parsed.success) return [];
  return parsed.data.flatMap(option => {
    const id = option.configId ?? option.id;
    if (!id) return [];
    return [{ id, ...(option.category !== undefined ? { category: option.category } : {}), ...(option.type !== undefined ? { type: option.type } : {}), ...(option.name !== undefined ? { name: option.name } : {}), ...(option.currentValue !== undefined ? { current: option.currentValue } : option.value !== undefined ? { current: option.value } : {}), choices: (option.options ?? []).flatMap(choice => { const value = choice.value ?? choice.id; return value !== undefined ? [{ value, ...(choice.name !== undefined ? { name: choice.name } : {}) }] : []; }) }];
  });
}
export function parseModes(input: unknown): { modes: Mode[]; currentMode?: string } {
  const parsed = z.safeParse(modes, input ?? {});
  if (!parsed.success) return { modes: [] };
  return {
    modes: (parsed.data.availableModes ?? []).flatMap(entry => { const id = entry.id ?? entry.modeId; return id ? [{ id, name: entry.name ?? id }] : []; }),
    ...(parsed.data.currentModeId !== undefined ? { currentMode: parsed.data.currentModeId } : {}),
  };
}
export function validateEvents(events: unknown[], label: string): AgentEvent[] {
  return events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error(`Invalid ${label} event`); return parsed.data; });
}
export const envelope = z.looseObject({ sessionId: z.string(), update: z.looseObject({ sessionUpdate: z.string() }) });
export const usageUpdate = z.looseObject({ used: z.optional(z.number()), size: z.optional(z.number()), cost: z.optional(z.nullable(z.looseObject({ amount: z.number(), currency: z.string() }))) });
export function mapUsage(input: unknown): unknown[] {
  const data = z.parse(usageUpdate, input);
  return [{ kind: 'usage', ...(data.used !== undefined ? { input: data.used } : {}), ...(data.cost?.currency === 'USD' ? { costUsd: data.cost.amount } : {}) }];
}
