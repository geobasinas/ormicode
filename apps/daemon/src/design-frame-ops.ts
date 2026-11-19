import { randomUUID } from 'node:crypto';
import { DESIGN_FRAME_LIMIT, type DesignDocument, type DesignFrame, type DesignFrameOperation, type DesignFramePatch, type DesignStackDirection } from '@ormicode/protocol';

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

/** Frames that share a stacking context with `frame` (all frames today; a page once pages exist). */
export function stackPeers(document: DesignDocument, frame: DesignFrame): DesignFrame[] {
  const page = (frame as { pageId?: unknown }).pageId;
  return document.frames.filter(item => (item as { pageId?: unknown }).pageId === page);
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

export function applyFrameOperation(document: DesignDocument, operation: DesignFrameOperation, fail: Fail): void {
  const frame = (id: string) => document.frames.find(item => item.id === id) ?? fail(`Frame not found: ${id}`);
  const unique = (ids: readonly string[]) => { if (new Set(ids).size !== ids.length) fail('Frame IDs must be unique'); ids.forEach(frame); return ids; };
  switch (operation.type) {
    case 'frames.set':
      unique(operation.frames.map(item => item.frameId));
      for (const item of operation.frames) applyFramePatch(frame(item.frameId), item.patch);
      break;
    case 'frames.remove': {
      const ids = new Set(unique(operation.frameIds));
      document.frames = document.frames.filter(item => !ids.has(item.id));
      document.comments = document.comments.filter(item => item.frameId === null || !ids.has(item.frameId));
      if (document.workingFrameId && ids.has(document.workingFrameId)) document.workingFrameId = null;
      break;
    }
    case 'frames.order': document.frames = reorderSlots(document.frames, unique(operation.frameIds)); break;
    case 'frames.stack': {
      const moving = new Set(unique(operation.frameIds));
      const pages = new Map<unknown, string[]>();
      for (const item of document.frames) {
        const page = (item as { pageId?: unknown }).pageId;
        if (moving.has(item.id) && !pages.has(page)) pages.set(page, stackPeers(document, item).map(peer => peer.id));
      }
      for (const peers of pages.values()) document.frames = reorderSlots(document.frames, stackOrder(peers, moving, operation.to));
      break;
    }
    case 'frames.group': {
      const groupId = randomUUID();
      for (const id of unique(operation.frameIds)) frame(id).groupId = groupId;
      break;
    }
    case 'frames.ungroup':
      if (!document.frames.some(item => item.groupId === operation.groupId)) fail(`Group not found: ${operation.groupId}`);
      for (const item of document.frames) if (item.groupId === operation.groupId) delete item.groupId;
      break;
    case 'frames.paste': {
      if (document.frames.length + operation.frames.length > DESIGN_FRAME_LIMIT) fail(`A board holds at most ${DESIGN_FRAME_LIMIT} frames`);
      const groups = new Map<string, string>();
      for (const { groupKey, ...fields } of operation.frames) {
        const groupId = groupKey ? groups.get(groupKey) ?? groups.set(groupKey, randomUUID()).get(groupKey)! : undefined;
        document.frames.push(normalizeFrameLayer({ ...fields, id: randomUUID(), ...(groupId ? { groupId } : {}) }));
      }
      break;
    }
    case 'frames.restore': {
      if (document.frames.length + operation.frames.length > DESIGN_FRAME_LIMIT) fail(`A board holds at most ${DESIGN_FRAME_LIMIT} frames`);
      for (const { frame: restored, index } of [...operation.frames].sort((a, b) => a.index - b.index)) {
        if (document.frames.some(item => item.id === restored.id)) fail(`Frame already exists: ${restored.id}`);
        document.frames.splice(Math.min(index, document.frames.length), 0, normalizeFrameLayer({ ...restored }));
      }
      for (const restored of operation.comments ?? []) {
        if (document.comments.some(item => item.id === restored.id)) continue;
        if (restored.frameId !== null) frame(restored.frameId);
        document.comments.push(restored);
      }
      break;
    }
  }
}
