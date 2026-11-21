/**
 * ACP session/new MCP-server conversion — local copy so this package stays
 * self-contained (vendor ACP packages never import each other or `agent-acp`;
 * shared logic is duplicated deliberately).
 */
import * as z from 'zod/mini';
import type { McpServerSpec } from '@ormicode/agent-core';

export interface ConfigOption { id: string; category?: string; type?: string; name?: string; current?: string | boolean; choices: { value: string | boolean; name?: string }[] }
export interface Mode { id: string; name: string }

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

/** ACP wire shape for session/new mcpServers. */
export interface AcpMcpServer { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
export function acpMcpServers(servers: Record<string, McpServerSpec> | undefined): AcpMcpServer[] {
  return Object.entries(servers ?? {}).map(([name, s]) => ({
    name, command: s.command, args: s.args ?? [],
    env: Object.entries(s.env ?? {}).map(([k, value]) => ({ name: k, value })),
  }));
}
