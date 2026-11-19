import type { DesignComment, DesignDocument, DesignFrame, DesignFramePatch, DesignOperation } from '@ormicode/protocol';

/** Local undo/redo of this client's own frame edits. Undo and redo send the inverse as a
 *  normal revisioned design.update, and refuse when a touched frame changed since. */
interface Touched { id: string; before: DesignFrame | null; after: DesignFrame | null; comments: DesignComment[] }
export interface HistoryEntry {
  label: string; frames: Touched[]; orderBefore: string[]; orderAfter: string[];
  workingBefore: string | null; workingAfter: string | null; bytes: number;
}
export interface HistoryStacks { undo: HistoryEntry[]; redo: HistoryEntry[] }
export const HISTORY_ENTRIES = 50;
export const HISTORY_BYTES = 2 * 1024 * 1024;
const layerKeys = new Set(['rotation', 'groupId', 'locked', 'hidden']);

function canonical(frame: DesignFrame | null | undefined): string {
  if (!frame) return 'null';
  const record = frame as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).filter(key => record[key] !== undefined && !(layerKeys.has(key) && !record[key])).sort().map(key => [key, record[key]]));
}
const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export function diffDocuments(before: DesignDocument, after: DesignDocument, label: string): HistoryEntry | null {
  const ids = [...new Set([...before.frames.map(frame => frame.id), ...after.frames.map(frame => frame.id)])];
  const frames: Touched[] = [];
  for (const id of ids) {
    const old = before.frames.find(frame => frame.id === id) ?? null;
    const next = after.frames.find(frame => frame.id === id) ?? null;
    if (canonical(old) !== canonical(next)) frames.push({ id, before: old, after: next, comments: (old && !next ? before : next && !old ? after : { comments: [] }).comments.filter(comment => comment.frameId === id) });
  }
  const orderBefore = before.frames.map(frame => frame.id); const orderAfter = after.frames.map(frame => frame.id);
  const shared = (order: string[], other: string[]) => order.filter(id => other.includes(id));
  const reordered = !sameOrder(shared(orderBefore, orderAfter), shared(orderAfter, orderBefore));
  if (!frames.length && !reordered && before.workingFrameId === after.workingFrameId) return null;
  const entry = { label, frames, orderBefore, orderAfter, workingBefore: before.workingFrameId, workingAfter: after.workingFrameId, bytes: 0 };
  entry.bytes = JSON.stringify(entry).length;
  return entry;
}

export function pushEntry(stack: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [...stack, entry].slice(-HISTORY_ENTRIES);
  while (next.length > 1 && next.reduce((total, item) => total + item.bytes, 0) > HISTORY_BYTES) next.shift();
  return entry.bytes > HISTORY_BYTES ? next.filter(item => item !== entry) : next;
}

/** Operations that take `current` from one side of `entry` to the other, or why that is unsafe. */
export function historyOperations(entry: HistoryEntry, current: DesignDocument, direction: 'undo' | 'redo'): { operations: DesignOperation[] } | { error: string } {
  const undo = direction === 'undo';
  const from = (item: Touched) => undo ? item.after : item.before;
  const to = (item: Touched) => undo ? item.before : item.after;
  const [fromOrder, toOrder] = undo ? [entry.orderAfter, entry.orderBefore] : [entry.orderBefore, entry.orderAfter];
  const [fromWorking, toWorking] = undo ? [entry.workingAfter, entry.workingBefore] : [entry.workingBefore, entry.workingAfter];
  for (const item of entry.frames) {
    const now = current.frames.find(frame => frame.id === item.id) ?? null;
    if (canonical(now) !== canonical(from(item))) return { error: `“${(now ?? from(item) ?? to(item))?.name ?? 'A frame'}” changed after this edit; nothing was ${direction === 'undo' ? 'undone' : 'redone'}.` };
    if (now && !to(item)) {
      const known = new Set(item.comments.map(comment => comment.id));
      if (current.comments.some(comment => comment.frameId === item.id && !known.has(comment.id))) return { error: `“${now.name}” gained feedback after this edit.` };
    }
  }
  const reordered = !sameOrder(fromOrder.filter(id => toOrder.includes(id)), toOrder.filter(id => fromOrder.includes(id)));
  const present = current.frames.map(frame => frame.id).filter(id => fromOrder.includes(id));
  if (reordered && !sameOrder(present, fromOrder.filter(id => present.includes(id)))) return { error: 'The layer order changed after this edit.' };
  if (fromWorking !== toWorking && current.workingFrameId !== fromWorking) return { error: 'The working direction changed after this edit.' };

  const operations: DesignOperation[] = [];
  const removed = entry.frames.filter(item => from(item) && !to(item)).map(item => item.id);
  if (removed.length) operations.push({ type: 'frames.remove', frameIds: removed });
  const restored = entry.frames.filter(item => !from(item) && to(item));
  if (restored.length) operations.push({ type: 'frames.restore', frames: restored.map(item => ({ frame: to(item)!, index: Math.max(0, toOrder.indexOf(item.id)) })),
    ...(restored.some(item => item.comments.length) ? { comments: restored.flatMap(item => item.comments) } : {}) });
  const patches = entry.frames.filter(item => from(item) && to(item)).map(item => ({ frameId: item.id, patch: framePatch(from(item)!, to(item)!) }));
  if (patches.length) operations.push({ type: 'frames.set', frames: patches });
  if (reordered || restored.length) {
    const kept = toOrder.filter(id => (current.frames.some(frame => frame.id === id) && !removed.includes(id)) || restored.some(item => item.id === id));
    if (kept.length) operations.push({ type: 'frames.order', frameIds: kept });
  }
  if (fromWorking !== toWorking) operations.push({ type: 'direction.select', frameId: toWorking });
  return operations.length ? { operations } : { error: 'Nothing to change.' };
}

function framePatch(from: DesignFrame, to: DesignFrame): DesignFramePatch {
  const patch: Record<string, unknown> = {};
  const a = from as Record<string, unknown>; const b = to as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'id' || JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    patch[key] = b[key] === undefined ? (layerKeys.has(key) ? (key === 'groupId' ? null : key === 'rotation' ? 0 : false) : undefined) : b[key];
  }
  return patch as DesignFramePatch;
}
