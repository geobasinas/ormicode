import type { SessionSummary } from './useSessions.ts';

export const parentlessHelp = 'Parent unavailable. This child keeps running independently; messages to the parent and approvals are routed to you.';
export function isTeamRunning(s: Pick<SessionSummary, 'state' | 'delegatedApproval'>): boolean {
  return !s.delegatedApproval && ['running', 'starting', 'retrying'].includes(s.state);
}
export function teamState(s: Pick<SessionSummary, 'state' | 'parentless' | 'delegatedApproval'>) {
  if (s.state === 'failed') return { label: 'Failed', tone: 'red', icon: 'failed', help: 'This session failed and needs attention.' };
  if (s.parentless) return { label: 'Parentless', tone: 'amber', icon: 'parentless', help: parentlessHelp };
  if (s.delegatedApproval) return { label: 'Needs parent', tone: 'neutral', icon: 'waiting', help: 'Waiting on the parent to answer a delegated approval.' };
  if (s.state === 'done') return { label: 'Done', tone: 'quiet', icon: 'done', help: 'This child has finished.' };
  if (['running', 'starting', 'retrying'].includes(s.state)) return { label: s.state === 'running' ? 'Running' : s.state === 'starting' ? 'Starting' : 'Retrying', tone: 'mint', icon: 'running', help: 'Working independently in this session.' };
  if (['awaiting_approval', 'awaiting_input', 'interrupted', 'paused_rate_limited'].includes(s.state)) return { label: 'Needs you', tone: 'amber', icon: 'waiting', help: 'Open this session to review the request.' };
  return { label: 'Idle', tone: 'quiet', icon: 'idle', help: 'Ready for the next task.' };
}

export function branchLabel(s: { branch?: string | null; worktree?: boolean }): string {
  return s.worktree && /(?:^|[-/])0[0-9a-hjkmnp-tv-z]{25}$/i.test(s.branch ?? '') ? 'worktree' : s.branch ?? '';
}

export function approvalInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string') return input.command;
  return input === undefined ? '' : JSON.stringify(input, null, 2);
}
