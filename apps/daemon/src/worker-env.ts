import type { SessionRow } from '@ormicode/session-store';
import { environmentForSession } from './session-env.ts';
import type { SecretBroker } from './secrets.ts';
import { sessionLogDir } from './socket.ts';

export function workerEnvironment(row: SessionRow, base: number, socket: string, secrets: SecretBroker, mcpToken: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...secrets.envFor(row.id, row.project),
    ...environmentForSession(row, base),
    ORMICODE_SOCKET: socket, ORMICODE_SESSION: row.id,
    ORMICODE_VENDOR: row.vendor, ORMICODE_TRANSPORT: row.transport,
    ORMICODE_CWD: row.cwd, ...(row.native_id ? { ORMICODE_RESUME: row.native_id } : {}),
    ORMICODE_LOG_DIR: sessionLogDir(row.id),
    ...(row.model && row.model !== 'default' ? { ORMICODE_MODEL: row.model } : {}),
    ...(row.effort && row.effort !== 'default' ? { ORMICODE_EFFORT: row.effort } : {}),
    ...(row.mode && row.mode !== 'default' ? { ORMICODE_MODE: row.mode } : {}),
    ...(row.agent_command ? { ORMICODE_AGENT_COMMAND: row.agent_command } : {}),
    ...(row.agent_args ? { ORMICODE_AGENT_ARGS_JSON: row.agent_args } : {}),
    ORMICODE_MCP: '1', ORMI_MCP_TOKEN: mcpToken,
  };
}
