import { execFile, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Kill a worker's whole process tree, not just the direct child.
 * Windows: taskkill /T reaps descendants (agent CLIs spawn grandchildren).
 * POSIX: kill the worker group and separately kill descendants that created
 * their own process groups.
 */
function linuxProcessTable(): [number, number][] {
  const processes: [number, number][] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      const pid = Number(entry); const ppid = Number(fields[1]);
      if (Number.isInteger(ppid)) processes.push([pid, ppid]);
    } catch { /* process exited or proc entry is unavailable */ }
  }
  return processes;
}

function psProcessTable(): [number, number][] {
  const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return output.split(/\r?\n/).flatMap(line => {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    return Number.isInteger(pid) && Number.isInteger(ppid) ? [[pid!, ppid!]] : [];
  });
}

function descendantsOf(pid: number): number[] {
  let table: [number, number][];
  try { table = process.platform === 'linux' ? linuxProcessTable() : psProcessTable(); }
  catch { try { table = psProcessTable(); } catch { return []; } }
  const children = new Map<number, number[]>();
  for (const [child, parent] of table) children.set(parent, [...(children.get(parent) ?? []), child]);
  const descendants: number[] = []; const queue = [pid];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]!) ?? []) { descendants.push(child); queue.push(child); }
  }
  return descendants;
}

function signal(pid: number): void {
  try { process.kill(pid, 'SIGKILL'); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

export function killTreePid(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => undefined);
    return;
  }
  const descendants = descendantsOf(pid);
  signal(-pid);
  signal(pid);
  for (const child of descendants) { signal(child); signal(-child); }
}

export function killTree(proc: ChildProcess): void {
  if (proc.pid !== undefined) killTreePid(proc.pid);
}
