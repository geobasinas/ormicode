import { useCallback, useRef, useState } from 'react';
import type { DesignDocument, DesignOperation } from '@ormicode/protocol';
import { diffDocuments, historyOperations, pushEntry, type HistoryStacks } from './frame-history.ts';

const labels: Record<string, string> = { 'frames.set': 'Transform', 'frames.paste': 'Paste', 'frames.remove': 'Delete', 'frames.order': 'Reorder', 'frames.stack': 'Reorder', 'frames.group': 'Group', 'frames.ungroup': 'Ungroup' };

/** Undo/redo stacks for this client's own successful edits on the current board. */
export function useFrameHistory() {
  const stacks = useRef<HistoryStacks>({ undo: [], redo: [] });
  const [, setVersion] = useState(0);
  const changed = () => setVersion(version => version + 1);
  const record = useCallback((before: DesignDocument, after: DesignDocument, operations: readonly DesignOperation[]) => {
    if (after.revision !== before.revision + 1 || !operations.some(operation => /^(frames?[.]|direction[.]select)/.test(operation.type))) return;
    const entry = diffDocuments(before, after, labels[operations[0]?.type ?? ''] ?? 'Edit');
    if (!entry) return;
    stacks.current = { undo: pushEntry(stacks.current.undo, entry), redo: [] };
    changed();
  }, []);
  const clear = useCallback(() => { stacks.current = { undo: [], redo: [] }; changed(); }, []);
  /** Send the inverse of the latest entry. Unsafe entries (frames changed since) are dropped with a reason. */
  const step = useCallback(async (direction: 'undo' | 'redo', current: DesignDocument | null, mutate: (operations: DesignOperation[]) => Promise<unknown>, onError: (message: string) => void) => {
    const source = stacks.current[direction];
    const entry = source.at(-1);
    if (!entry || !current) return false;
    const plan = historyOperations(entry, current, direction);
    if ('error' in plan) {
      stacks.current = { ...stacks.current, [direction]: source.slice(0, -1) };
      changed(); onError(plan.error); return false;
    }
    if (!await mutate(plan.operations)) return false;
    const target = direction === 'undo' ? 'redo' : 'undo';
    if (stacks.current[direction].at(-1) === entry) stacks.current = { ...stacks.current, [direction]: stacks.current[direction].slice(0, -1), [target]: pushEntry(stacks.current[target], entry) } as HistoryStacks;
    changed(); return true;
  }, []);
  return { record, clear, step, canUndo: stacks.current.undo.length > 0, canRedo: stacks.current.redo.length > 0, undoLabel: stacks.current.undo.at(-1)?.label, redoLabel: stacks.current.redo.at(-1)?.label };
}
export type FrameHistory = ReturnType<typeof useFrameHistory>;
