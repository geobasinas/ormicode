import { createHash, randomUUID } from 'node:crypto';
import type { DesignActor, DesignDocument, DesignFrame, DesignOperation, DesignStorage } from '@ormicode/protocol';
import type { Client } from './dispatch.ts';
import { DesignError } from './design-store.ts';

export interface ReviewContext { actor: DesignActor; mentionable: Set<string>; history: DesignStorage['history'] }
export const contentHash = (frame: DesignFrame): string => createHash('sha256').update(JSON.stringify([frame.html, frame.styles, frame.width, frame.height])).digest('hex');
export const actorFor = (client: Pick<Client, 'device'>, session: string): DesignActor => ({ kind: client.device === 'mcp' ? 'agent' : 'user', session, device: client.device });
const invalid = (message: string): never => { throw new DesignError('design.invalid', message); };

export function applyReviewOperation(document: DesignDocument, operation: DesignOperation, context: ReviewContext): boolean {
  const { actor } = context;
  const frame = (id: string) => document.frames.find(item => item.id === id) ?? invalid(`Frame not found: ${id}`);
  const comment = (id: string) => document.comments.find(item => item.id === id) ?? invalid(`Comment not found: ${id}`);
  const checkMentions = (mentions: string[] = []) => {
    if (mentions.some(id => !context.mentionable.has(id))) invalid('Mention must belong to this workspace');
  };
  switch (operation.type) {
    case 'comment.add': {
      if (operation.frameId !== null) frame(operation.frameId);
      if (operation.path !== undefined && operation.frameId === null) invalid('Element anchors require a frame');
      checkMentions(operation.mentions);
      const { type: _, ...fields } = operation;
      document.comments.push({ ...fields, id: randomUUID(), resolved: false, session: actor.session, author: actor, createdAt: Date.now() });
      return true;
    }
    case 'comment.resolve': {
      const target = comment(operation.commentId);
      target.resolved = operation.resolved;
      if (operation.resolved) { target.resolvedAt = Date.now(); target.resolvedBy = actor; }
      else { delete target.resolvedAt; delete target.resolvedBy; }
      return true;
    }
    case 'comment.reply': {
      checkMentions(operation.mentions);
      const target = comment(operation.commentId);
      (target.replies ??= []).push({ id: randomUUID(), text: operation.text, ...(operation.mentions ? { mentions: operation.mentions } : {}), author: actor, createdAt: Date.now() });
      return true;
    }
    case 'frame.approval': {
      if (actor.kind === 'agent') throw new DesignError('design.forbidden', 'Only a user can change approval');
      const target = frame(operation.frameId);
      if (operation.status === 'draft') delete target.approval;
      else target.approval = { status: 'approved', by: actor, at: Date.now(), revision: document.revision + 1, contentHash: contentHash(target) };
      return true;
    }
    case 'frame.restoreVersion': {
      const target = frame(operation.frameId);
      const source = context.history.find(entry => entry.revision === operation.revision)?.document.frames.find(item => item.id === operation.frameId);
      if (!source) throw new DesignError('design.not_found', 'Frame version is no longer retained');
      const { html, styles, width, height } = source;
      Object.assign(target, { html, styles, width, height });
      return true;
    }
    default: return false;
  }
}

export function normalizeReview(document: DesignDocument): DesignDocument {
  const result = structuredClone(document);
  for (const frame of result.frames) {
    if (frame.approval?.status === 'approved' && frame.approval.contentHash !== contentHash(frame)) frame.approval.status = 'needs_review';
  }
  return result;
}

export function finalizeReview(before: DesignDocument, after: DesignDocument, options: { restore: boolean }): void {
  for (const frame of after.frames) {
    const previous = before.frames.find(item => item.id === frame.id);
    if (!previous || options.restore) {
      delete frame.approval;
      if (previous?.approval && options.restore) frame.approval = structuredClone(previous.approval);
    }
    if (frame.approval?.status === 'approved' && frame.approval.contentHash !== contentHash(frame)) frame.approval.status = 'needs_review';
  }
}

export function frameVersions(stored: DesignStorage, frameId: string) {
  const entries = [{ revision: stored.document.revision, at: 0, summary: 'Current version', document: stored.document }, ...stored.history.slice().reverse()];
  const versions: { revision: number; at: number; summary: string; current: boolean; html: string; styles: string; width: number; height: number; contentHash: string }[] = [];
  for (const entry of entries) {
    const frame = entry.document.frames.find(item => item.id === frameId);
    if (!frame) continue;
    const hash = contentHash(frame);
    if (versions.at(-1)?.contentHash === hash) continue;
    const { html, styles, width, height } = frame;
    versions.push({ revision: entry.revision, at: entry.at, summary: entry.summary, current: entry === entries[0], html, styles, width, height, contentHash: hash });
  }
  return { versions };
}
