import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * Kill a worker's whole process tree, not just the direct child.
 * Windows: taskkill /T reaps descendants (agent CLIs spawn grandchildren).
 * POSIX: workers are spawned detached, so the child leads a process group —
 * kill the group with a negative pid.
 */
export function killTreePid(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => undefined);
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); }
  catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ } }
}

export function killTree(proc: ChildProcess): void {
  if (proc.pid !== undefined) killTreePid(proc.pid);
}
