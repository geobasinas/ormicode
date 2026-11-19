import type { DesignActor, DesignDocument, DesignFrame } from '@ormicode/protocol';

export type ReviewComment = DesignDocument['comments'][number];
export type MentionableSession = { id: string; title?: string; vendor: string };
export type CommentTarget = { frameId: string | null; point?: { x: number; y: number }; path?: string; element?: string };
export type FrameVersion = { revision: number; at: number; summary: string; current: boolean; html: string; styles: string; width: number; height: number; contentHash: string };

export function annotationAnchor(comment: ReviewComment, frames: DesignFrame[], index = 0) {
  if (comment.frameId === null) return comment.point ?? null;
  const frame = frames.find(item => item.id === comment.frameId);
  if (!frame) return null;
  if (comment.point && !comment.path) return { x: frame.x + comment.point.x, y: frame.y + comment.point.y };
  return { x: frame.x + frame.width, y: frame.y + 24 + index * 32 };
}

export function actorLabel(actor: DesignActor | undefined, sessions: MentionableSession[], legacySession?: string): string {
  if (actor?.kind === 'user') return 'You';
  const id = actor?.session ?? legacySession;
  const title = sessions.find(item => item.id === id)?.title || id || 'Unknown';
  return actor?.kind === 'agent' ? `Agent · ${title}` : title;
}

export function mentionToken(session: MentionableSession, sessions: MentionableSession[] = []): string {
  const token = session.title?.trim().replace(/\s+/g, '-') || session.id;
  const duplicates = sessions.filter(item => item.title?.trim().replace(/\s+/g, '-').toLowerCase() === token.toLowerCase());
  return /^[\p{L}\p{N}_-]+$/u.test(token) && duplicates.length < 2 ? token : session.id;
}
export function activeMentionQuery(text: string, caret: number): { query: string; start: number; end: number } | null {
  const prefix = text.slice(0, Math.max(0, caret));
  const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
  return match ? { query: match[1], start: prefix.length - match[1].length - 1, end: prefix.length } : null;
}

export function extractMentions(text: string, sessions: MentionableSession[]): string[] {
  const tokens = [...text.matchAll(/(?:^|\s)@([^\s@,!?;:()]+)/g)].map(match => match[1].replace(/\.$/, '').toLowerCase());
  return [...new Set(tokens.flatMap(token => {
    const found = sessions.find(session => session.id.toLowerCase() === token || mentionToken(session, sessions).toLowerCase() === token);
    return found ? [found.id] : [];
  }))].slice(0, 8);
}

export const approvalLabel = (frame: DesignFrame): 'Draft' | 'Approved' | 'Needs review' => frame.approval?.status === 'approved' ? 'Approved' : frame.approval?.status === 'needs_review' ? 'Needs review' : 'Draft';
export const filterThreads = (comments: ReviewComment[], filter: 'open' | 'resolved'): ReviewComment[] => comments.filter(comment => comment.resolved === (filter === 'resolved'));
export function targetLabel(target: CommentTarget, frames: DesignFrame[]): string {
  const name = frames.find(frame => frame.id === target.frameId)?.name ?? (target.frameId ? 'Deleted frame' : 'Canvas');
  if (target.path) return `${name} · ${target.element || 'Element'} (${target.path})`;
  if (target.point) return `${name} · ${Math.round(target.point.x)}, ${Math.round(target.point.y)}`;
  return target.element ? `${name} · ${target.element}` : name;
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
