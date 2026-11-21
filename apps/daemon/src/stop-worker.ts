import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { Link } from './socket.ts';
import { killTree } from './proctree.ts';

export async function stopWorkerProcess(proc: ChildProcess, link: Link | undefined, session: string, force: boolean): Promise<void> {
  if (!force && link) {
    try { await link.request('worker.evict', { session }, 10_000); return; } catch { /* force termination below */ }
  }
  // Stop means stop: nothing the dying worker still sends (a tool that just
  // finished, an approval, a turn end) may be journaled before it is gone.
  if (force && link) link.onFrame = () => undefined;
  const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : once(proc, 'exit');
  killTree(proc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker did not stop')), 5000); })]);
  } finally { clearTimeout(timer); }
}
