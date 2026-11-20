import type { SessionSummary } from './useSessions.ts';
import type { DigestEntry } from './useDigest.ts';
import { needsUser } from './team-tree.ts';

export function needsAttention(session: SessionSummary, entry?: DigestEntry): boolean {
  const userRequest = entry?.rank === 'waiting' && (entry.wants?.kind === 'approval' || entry.wants?.kind === 'question');
  return session.state !== 'archived' && (!session.delegatedApproval || userRequest)
    && (needsUser(session) || entry?.rank === 'waiting' || entry?.rank === 'failed');
}

export function attentionReason(session: SessionSummary, entry?: DigestEntry): string {
  const wants = entry && entry.rank !== 'silent' ? entry.wants?.kind : undefined;
  if (wants === 'question' || session.state === 'awaiting_input') return 'Question for you';
  if (wants === 'approval' || session.state === 'awaiting_approval') return 'Approval needed';
  if (wants === 'rate_limit' || session.state === 'paused_rate_limited') return 'Rate limited';
  return session.state === 'interrupted' ? 'Session interrupted' : 'Session failed';
}
