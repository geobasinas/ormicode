/**
 * Spawned by agents as `node mcp-serve.ts` (stdio MCP server). Requires
 * ORMICODE_SOCKET (daemon socket) and ORMI_SESSION (the owning session).
 */
import { serveOrmiMcp } from './mcp.ts';

const socket = process.env.ORMICODE_SOCKET;
const session = process.env.ORMI_SESSION;
if (!socket || !session) {
  console.error('ormi mcp server: ORMICODE_SOCKET and ORMI_SESSION are required');
  process.exit(2);
}
await serveOrmiMcp(socket, session);
