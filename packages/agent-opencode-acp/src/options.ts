/**
 * ACP session/new MCP-server conversion — local copy so this package stays
 * self-contained (vendor ACP packages never import each other or `agent-acp`;
 * shared logic is duplicated deliberately).
 */
import type { McpServerSpec } from '@ormicode/agent-core';

/** ACP wire shape for session/new mcpServers. */
export interface AcpMcpServer { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
export function acpMcpServers(servers: Record<string, McpServerSpec> | undefined): AcpMcpServer[] {
  return Object.entries(servers ?? {}).map(([name, s]) => ({
    name, command: s.command, args: s.args ?? [],
    env: Object.entries(s.env ?? {}).map(([k, value]) => ({ name: k, value })),
  }));
}
