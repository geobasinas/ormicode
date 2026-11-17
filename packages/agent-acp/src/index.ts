export { JsonRpcPeer, AcpError } from './jsonrpc.ts';
export { AcpAdapter, connect } from './adapter.ts';
export type { AcpEndpoint } from './adapter.ts';
export { createV1Profile } from './v1.ts';
export { createV2Profile } from './v2.ts';
export { AcpPermissionBroker } from './permissions.ts';
export type { AcpProfile, ConfigOption, Mode, SessionBootstrap, TurnMapper, AgentInfo, AcpMcpServer } from './profile.ts';
export { acpMcpServers } from './profile.ts';
export { parseOptions, parseModes } from './profile.ts';
import { AcpAdapter } from './adapter.ts';
import type { Handle } from '@ormicode/agent-core';
import type { Spawn } from './jsonrpc.ts';

/** Start a generic ACP adapter. Command defaults to ORMICODE_ACP_COMMAND / ORMICODE_ACP_ARGS for tests. */
export function createAcpAdapter(options: { vendor?: string; command?: string; args?: string[]; spawn?: Spawn; preferV1?: boolean; onNativeId?: (handle: Handle, id: string) => void } = {}): AcpAdapter {
  const command = options.command ?? process.env.ORMICODE_ACP_COMMAND;
  if (!command) throw new Error('No ACP command; set options.command or ORMICODE_ACP_COMMAND');
  const args = options.args ?? (process.env.ORMICODE_ACP_ARGS ? process.env.ORMICODE_ACP_ARGS.split(' ').filter(Boolean) : []);
  return new AcpAdapter({ vendor: options.vendor, command, args, ...(options.spawn ? { spawn: options.spawn } : {}), ...(options.preferV1 !== undefined ? { preferV1: options.preferV1 } : {}), ...(options.onNativeId ? { onNativeId: options.onNativeId } : {}) });
}
