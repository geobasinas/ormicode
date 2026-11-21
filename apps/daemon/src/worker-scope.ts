// Per-worker memory caps (README "Daemon"): Linux gets a real cgroup cap via
// `systemd-run --user --scope -p MemoryMax=` when the user manager is usable;
// other platforms fall back to the supervisor killing workers whose reported
// RSS exceeds the cap. Windows job objects need native code we don't ship.
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

let scopeProbe: boolean | undefined;

/** True when `systemd-run --user --scope` actually works on this machine. */
export function systemdScopeAvailable(): boolean {
  if (platform() !== 'linux' || process.env.ORMICODE_SYSTEMD_SCOPE === '0') return false;
  if (scopeProbe !== undefined) return scopeProbe;
  try {
    execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '--', '/bin/true'], { stdio: 'ignore', timeout: 10_000 });
    scopeProbe = true;
  } catch { scopeProbe = false; }
  return scopeProbe;
}

/**
 * Spawn argv/env overrides for a memory-capped worker, or undefined to spawn
 * the worker directly. `capBytes` undefined means no cap was computed.
 */
export function systemdScopeArgs(capBytes: number | undefined, workerArgv: string[]): { command: string; args: string[] } | undefined {
  if (capBytes === undefined || !systemdScopeAvailable()) return undefined;
  return {
    command: 'systemd-run',
    args: ['--user', '--scope', '--quiet', '--collect', '-p', `MemoryMax=${capBytes}`, '--', ...workerArgv],
  };
}

/** RSS guard used on platforms without a kernel cap (and as a backstop). */
export function overMemoryCap(rssBytes: number, capBytes: number | undefined): boolean {
  return capBytes !== undefined && rssBytes > capBytes;
}
