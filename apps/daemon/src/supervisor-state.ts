import type { SessionState } from '@ormicode/session-store';

export const stateFor: Record<string, SessionState> = {
  turn_start: 'running', turn_end: 'idle', approval_request: 'awaiting_approval',
  approval_decision: 'running', question_request: 'awaiting_input',
  rate_limited: 'retrying', retry_scheduled: 'retrying', interrupted: 'interrupted',
};
