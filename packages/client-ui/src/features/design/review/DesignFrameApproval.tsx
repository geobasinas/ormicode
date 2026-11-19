import type { DesignFrame } from '@ormicode/protocol';
import { actorLabel, approvalLabel, type MentionableSession } from './review-model.ts';
import './review.css';

export function DesignFrameApproval({ frame, sessions, disabled, onApprove }: {
  frame: DesignFrame; sessions: MentionableSession[]; disabled: boolean; onApprove(status: 'approved' | 'draft'): void;
}) {
  const approval = frame.approval;
  const title = approval ? `${actorLabel(approval.by, sessions)} · ${new Date(approval.at).toLocaleString()} · approved r${approval.revision}` : 'Not yet approved';
  return <section className="design-properties"><h3>Review status</h3><span className="review-badge" data-status={approval?.status} title={title}>{approvalLabel(frame)}</span>
    <div className="design-inline">
      {approval?.status !== 'approved' ? <button type="button" className="design-button" disabled={disabled} onClick={() => onApprove('approved')}>{approval ? 'Approve again' : 'Approve'}</button> : null}
      {approval ? <button type="button" className="design-button" disabled={disabled} onClick={() => onApprove('draft')}>Move to draft</button> : null}
    </div>
  </section>;
}
