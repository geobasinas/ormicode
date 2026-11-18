import { sessionsInStates, type SessionState, type Store } from '@ormicode/session-store';

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
