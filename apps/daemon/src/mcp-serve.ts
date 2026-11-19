/**
 * Spawned by agents as `node mcp-serve.ts` (stdio MCP server). Requires
 * ORMICODE_SOCKET, ORMI_SESSION and ORMI_MCP_TOKEN.
 */
import { serveOrmiMcp } from './mcp.ts';

const socket = process.env.ORMICODE_SOCKET;
const session = process.env.ORMI_SESSION;
const token = process.env.ORMI_MCP_TOKEN;
delete process.env.ORMI_MCP_TOKEN;
if (!socket || !session || !token) {
  console.error('ormi mcp server: ORMICODE_SOCKET, ORMI_SESSION and ORMI_MCP_TOKEN are required');
  process.exit(2);
}
await serveOrmiMcp(socket, session, token);
