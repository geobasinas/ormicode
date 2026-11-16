import { AcpConnection } from './connection.ts';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
export { AcpConnection } from './connection.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Start OpenCode's ACP server. */
export function startOpenCodeAcp(options: { cwd?: string; executable?: string; spawn?: Spawn; onNotification?: (method: string, params: unknown) => void } = {}): Promise<AcpConnection> {
  return AcpConnection.start({ executable: options.executable ?? 'opencode', args: ['acp'], cwd: options.cwd, spawn: options.spawn, onNotification: options.onNotification });
}
export * from './adapter.ts';
export * from './map.ts';
