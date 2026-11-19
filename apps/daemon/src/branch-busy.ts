import { sessionsInStates, type SessionState, type Store } from '@ormicode/session-store';
import { resolve } from 'node:path';

const LIVE_STATES = [
  'idle', 'starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying',
  'paused_rate_limited', 'interrupted',
] as const satisfies readonly SessionState[];

export function busyBranches(db: Store, project: string, exceptSession?: string): string[] {
  return [...new Set(sessionsInStates(db, LIVE_STATES)
    .filter(session => session.id !== exceptSession && session.project === project && session.branch)
    .map(session => session.branch!))].sort();
}

export function branchIsBusy(db: Store, project: string, branch: string, exceptSession?: string): boolean {
  return busyBranches(db, project, exceptSession).includes(branch);
}

export function mainCheckoutIsBusy(db: Store, project: string): boolean {
  const canonical = (path: string) => {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  return sessionsInStates(db, LIVE_STATES).some(session =>
    session.project === project && canonical(session.cwd) === canonical(project));
}
