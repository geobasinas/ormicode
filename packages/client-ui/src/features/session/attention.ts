import type { SessionSummary } from './useSessions.ts';
import type { DigestEntry } from './useDigest.ts';
import { needsUser } from './team-tree.ts';

export function needsAttention(session: SessionSummary, entry?: DigestEntry): boolean {
  if (['idle', 'interrupted', 'failed', 'done', 'archived', 'paused_rate_limited'].includes(session.state)) return false;
  const userRequest = entry?.rank === 'waiting' && (entry.wants?.kind === 'approval' || entry.wants?.kind === 'question');
  return needsUser(session) || userRequest;
}

export function attentionReason(session: SessionSummary, entry?: DigestEntry): string {
  const wants = needsAttention(session, entry) && entry && entry.rank !== 'silent' ? entry.wants?.kind : undefined;
  if (wants === 'question' || session.state === 'awaiting_input') return 'Question for you';
  if (wants === 'approval' || session.state === 'awaiting_approval') return 'Approval needed';
  if (wants === 'rate_limit' || session.state === 'paused_rate_limited') return 'Rate limited';
  return session.state === 'interrupted' ? 'Session stopped' : session.state === 'failed' ? 'Session failed' : '';
}
