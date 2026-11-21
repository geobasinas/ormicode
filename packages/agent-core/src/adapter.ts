import type { AgentEvent } from '@ormicode/protocol';

export type Transport = 'sdk' | 'cli' | 'acp';
export interface Capabilities {
  approvals: boolean; steer: boolean; resume: boolean; model: boolean; effort: boolean;
  modes: boolean; configOptions: boolean; images: boolean; plan: boolean;
  subagents: boolean; nativeWindows: boolean;
}
export const NO_CAPABILITIES: Readonly<Capabilities> = Object.freeze({
  approvals: false, steer: false, resume: false, model: false, effort: false,
  modes: false, configOptions: false, images: false, plan: false, subagents: false, nativeWindows: false,
});
export interface DetectResult { available: boolean; version?: string; reason?: string }
export interface Model { id: string; name?: string; efforts?: readonly string[]; available?: boolean; reason?: string }
export type ModelList = readonly Model[];
/** A stdio MCP server the agent should launch (command + args + env). */
export interface McpServerSpec { command: string; args?: string[]; env?: Record<string, string> }
export interface StartSpec { cwd: string; model?: string; effort?: string; mode?: string; logDir?: string; mcpServers?: Record<string, McpServerSpec> }
export interface NativeRef { id: string; cwd: string; model?: string; effort?: string; mode?: string; logDir?: string; mcpServers?: Record<string, McpServerSpec> }
export interface Handle { readonly id: string }
export interface PromptInput { text: string; images?: { data: string; mimeType: string }[] }
export interface AgentCommand { name: string; description: string; source: 'agent' }
export interface HandoffState { summary: string }
/** A vendor-advertised session setting (ACP configOptions). `current` is the live value. */
export interface SessionOption { id: string; category?: string; type?: string; name?: string; current?: string | boolean; choices?: { value: string | boolean; name?: string }[] }
/** A vendor-advertised session mode (permission/agent modes). */
export interface SessionMode { id: string; name: string }

/** Capabilities describe verified behavior; unsupported operations are omitted. */
export interface AgentAdapter {
  readonly id: string;
  readonly transport: Transport;
  readonly capabilities: Readonly<Capabilities>;
  detect(): Promise<DetectResult>;
  models(): Promise<ModelList>;
  start(spec: StartSpec): Promise<Handle>;
  resume?(ref: NativeRef): Promise<Handle>;
  prompt(handle: Handle, input: PromptInput): Promise<void>;
  steer?(handle: Handle, input: PromptInput): Promise<void>;
  setModel?(handle: Handle, model: string): Promise<void>;
  setEffort?(handle: Handle, effort: string): Promise<void>;
  setMode?(handle: Handle, mode: string): Promise<void>;
  setOption?(handle: Handle, id: string, value: string | boolean): Promise<void>;
  approve?(handle: Handle, requestId: string, optionId: string): Promise<void>;
  answerQuestion?(handle: Handle, requestId: string, answers: Record<string, string>): Promise<void>;
  interrupt?(handle: Handle): Promise<void>;
  compact?(handle: Handle, instructions?: string): Promise<void>;
  exportState?(handle: Handle): Promise<HandoffState>;
  events(handle: Handle): AsyncIterable<AgentEvent>;
  commands?(handle: Handle): Promise<AgentCommand[]>;
  /** Advertised config options for this session (approval/permission settings included); omitted when the transport has none. May be async when discovery needs I/O. */
  configOptions?(handle: Handle): readonly SessionOption[] | Promise<readonly SessionOption[]>;
  /** Advertised session modes (e.g. permission modes); omitted when the transport has no enumerable list. May be async when discovery needs I/O. */
  modes?(handle: Handle): readonly SessionMode[] | Promise<readonly SessionMode[]>;
  /** Modes enumerable without a live session (static lists, config files, agent catalogs). Omitted when the vendor only negotiates modes at session start. */
  agentModes?(cwd?: string): readonly SessionMode[] | Promise<readonly SessionMode[]>;
  dispose(handle: Handle): Promise<void>;
}

/** Reject a capability claim that cannot be fulfilled through the interface. */
export function validateCapabilities(adapter: AgentAdapter): string[] {
  const checks = [
    ['approvals', 'approve'], ['steer', 'steer'], ['resume', 'resume'],
    ['model', 'setModel'], ['effort', 'setEffort'], ['modes', 'setMode'],
    ['configOptions', 'setOption'],
  ] as const;
  return checks.flatMap(([capability, method]) =>
    adapter.capabilities[capability] && typeof adapter[method] !== 'function'
      ? [`${capability} requires ${method}`] : [],
  );
}
