import { randomUUID } from 'node:crypto';
import { DESIGN_FRAME_LIMIT, type DesignDocument, type DesignFrame, type DesignFrameOperation, type DesignFramePatch, type DesignStackDirection, type DesignStorage } from '@ormicode/protocol';

import { clearPageStart, materializePages, pageIdOf } from './design-pages.ts';

type Fail = (message: string) => never;

/** Store layer state minimally: 0°, no group, unlocked and visible are absent fields. */
export function normalizeFrameLayer(frame: DesignFrame): DesignFrame {
  const record = frame as Record<string, unknown>;
  if (!frame.rotation) delete record.rotation;
  if (!frame.groupId) delete record.groupId;
  if (!frame.locked) delete record.locked;
  if (!frame.hidden) delete record.hidden;
  return frame;
}

export function applyFramePatch(frame: DesignFrame, patch: DesignFramePatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete (frame as Record<string, unknown>)[key];
    else (frame as Record<string, unknown>)[key] = key === 'rotation' ? Math.round((value as number) * 100) / 100 : value;
  }
  normalizeFrameLayer(frame);
}

/** Frames that share a stacking context with `frame`. */
export function stackPeers(document: DesignDocument, frame: DesignFrame): DesignFrame[] {
  return document.frames.filter(item => item.pageId === frame.pageId);
}

/** Fill the stack slots the listed frames occupy with them in the given back-to-front order. */
export function reorderSlots(frames: DesignFrame[], ordered: readonly string[]): DesignFrame[] {
  const wanted = new Set(ordered);
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  const queue = ordered.map(id => byId.get(id)!);
  return frames.map(frame => wanted.has(frame.id) ? queue.shift()! : frame);
}

export function stackOrder(peers: readonly string[], moving: ReadonlySet<string>, to: DesignStackDirection): string[] {
  const rest = peers.filter(id => !moving.has(id));
  const picked = peers.filter(id => moving.has(id));
  if (to === 'front') return [...rest, ...picked];
  if (to === 'back') return [...picked, ...rest];
  const order = [...peers];
  const step = to === 'forward' ? 1 : -1;
  const indexes = order.map((id, index) => moving.has(id) ? index : -1).filter(index => index >= 0);
  if (step === 1) indexes.reverse();
  for (const index of indexes) {
    const target = index + step;
    if (target < 0 || target >= order.length || moving.has(order[target]!)) continue;
    [order[index], order[target]] = [order[target]!, order[index]!];
  }
  return order;
}

/** Groups need two members; a group left with one frame dissolves. */
export function normalizeGroups(document: DesignDocument): void {
  const counts = new Map<string, number>();
  for (const frame of document.frames) if (frame.groupId) counts.set(frame.groupId, (counts.get(frame.groupId) ?? 0) + 1);
  for (const frame of document.frames) if (frame.groupId && (counts.get(frame.groupId) ?? 0) < 2) delete frame.groupId;
}

export function applyFrameOperation(document: DesignDocument, operation: DesignFrameOperation, fail: Fail, history: DesignStorage['history'] = []): void {
  const frame = (id: string) => document.frames.find(item => item.id === id) ?? fail(`Frame not found: ${id}`);
  const unique = (ids: readonly string[]) => { if (new Set(ids).size !== ids.length) fail('Frame IDs must be unique'); ids.forEach(frame); return ids; };
  switch (operation.type) {
    case 'frames.set':
      unique(operation.frames.map(item => item.frameId));
      if (operation.frames.some(item => item.patch.pageId)) materializePages(document);
      for (const { frameId, patch } of operation.frames) {
        const target = frame(frameId);
        if (patch.pageId && patch.pageId !== target.pageId) { clearPageStart(document, frameId); delete target.groupId; }
        applyFramePatch(target, patch);
      }
      break;
    case 'frames.remove': {
      const ids = new Set(unique(operation.frameIds));
      for (const id of ids) clearPageStart(document, id);
      document.frames = document.frames.filter(item => !ids.has(item.id));
      document.comments = document.comments.filter(item => item.frameId === null || !ids.has(item.frameId));
      if (document.workingFrameId && ids.has(document.workingFrameId)) document.workingFrameId = null;
      break;
    }
    case 'frames.order': document.frames = reorderSlots(document.frames, unique(operation.frameIds)); break;
    case 'frames.stack': {
      const moving = new Set(unique(operation.frameIds));
      const pages = new Map<string | undefined, string[]>();
      for (const item of document.frames) {
        const page = item.pageId;
        if (moving.has(item.id) && !pages.has(page)) pages.set(page, stackPeers(document, item).map(peer => peer.id));
      }
      for (const peers of pages.values()) document.frames = reorderSlots(document.frames, stackOrder(peers, moving, operation.to));
      break;
    }
    case 'frames.group': {
      const groupId = randomUUID();
      const frames = unique(operation.frameIds).map(frame);
      if (new Set(frames.map(item => item.pageId)).size > 1) fail('Group members must belong to the same page');
      for (const item of frames) item.groupId = groupId;
      break;
    }
    case 'frames.ungroup':
      if (!document.frames.some(item => item.groupId === operation.groupId)) fail(`Group not found: ${operation.groupId}`);
      for (const item of document.frames) if (item.groupId === operation.groupId) delete item.groupId;
      break;
    case 'frames.paste': {
      if (document.frames.length + operation.frames.length > DESIGN_FRAME_LIMIT) fail(`A board holds at most ${DESIGN_FRAME_LIMIT} frames`);
      if (operation.frames.some(item => item.pageId && item.pageId !== 'default')) materializePages(document);
      const groups = new Map<string, string>();
      for (const { groupKey: key, pageId, ...fields } of operation.frames) {
        const page = pageIdOf(document, pageId);
        const groupKey = key && JSON.stringify([page, key]);
        const groupId = groupKey ? groups.get(groupKey) ?? groups.set(groupKey, randomUUID()).get(groupKey)! : undefined;
        document.frames.push(normalizeFrameLayer({ ...fields, id: randomUUID(), ...(page ? { pageId: page } : {}), ...(groupId ? { groupId } : {}) }));
      }
      break;
    }
    case 'frames.restore': {
      if (document.frames.length + operation.frames.length > DESIGN_FRAME_LIMIT) fail(`A board holds at most ${DESIGN_FRAME_LIMIT} frames`);
      if (operation.frames.some(item => item.frame.pageId)) materializePages(document);
      for (const { frame: restored, index } of [...operation.frames].sort((a, b) => a.index - b.index)) {
        if (document.frames.some(item => item.id === restored.id)) fail(`Frame already exists: ${restored.id}`);
        const { pageId, ...fields } = restored;
        const page = pageIdOf(document, pageId);
        document.frames.splice(Math.min(index, document.frames.length), 0, normalizeFrameLayer({ ...fields, ...(page ? { pageId: page } : {}) }));
      }
      for (const restored of operation.comments ?? []) {
        if (document.comments.some(item => item.id === restored.id)) continue;
        if (restored.frameId !== null) frame(restored.frameId);
        const stored = history.slice().reverse().flatMap(entry => entry.document.comments).find(comment => comment.id === restored.id && comment.frameId === restored.frameId);
        document.comments.push(stored ?? fail('Comment is no longer retained in board history'));
      }
      break;
    }
  }
}
