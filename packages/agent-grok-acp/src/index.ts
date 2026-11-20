import { AcpConnection } from './connection.ts';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
export { AcpConnection } from './connection.ts';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Start Grok's ACP server without granting automatic tool approvals. */
export function startGrokAcp(options: { cwd?: string; executable?: string; spawn?: Spawn; onNotification?: (method: string, params: unknown) => void } = {}): Promise<AcpConnection> {
  return AcpConnection.start({ executable: options.executable ?? 'grok', args: ['--no-auto-update', 'agent', 'stdio'], cwd: options.cwd, spawn: options.spawn, onNotification: options.onNotification });
}
export * from './adapter.ts';
export { GrokInteractiveCliAdapter } from './cli.ts';
export * from './map.ts';
