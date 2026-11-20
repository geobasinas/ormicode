import { BringToFront, Copy, EyeOff, Group, Lock, LockOpen, Redo2, SendToBack, Undo2, Ungroup } from 'lucide-react';
import type { FrameHistory } from './useFrameHistory.ts';
import type { DesignFrames } from './useDesignFrames.ts';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Frame arrangement and history commands for the current selection. */
export function FrameToolbar({ frames, history, disabled }: { frames: DesignFrames; history: FrameHistory; disabled: boolean }) {
  const { actions, editable, selected, grouped } = frames;
  const locked = selected.length > 0 && selected.every(frame => frame.locked);
  const button = (label: string, keys: string, Icon: typeof Copy, run: () => void, off: boolean) =>
    <button className="design-icon-button" type="button" title={`${label} (${keys})`} aria-label={label} disabled={disabled || off} onClick={run}><Icon size={15} /></button>;
  return <div className="design-float design-frames-toolbar" role="group" aria-label="Frame arrangement">
    {button(history.undoLabel ? `Undo ${history.undoLabel.toLowerCase()}` : 'Undo', `${mod}Z`, Undo2, actions.undo, !history.canUndo)}
    {button(history.redoLabel ? `Redo ${history.redoLabel.toLowerCase()}` : 'Redo', `${mod}Shift+Z`, Redo2, actions.redo, !history.canRedo)}
    <span className="design-divider" />
    {selected.length > 1 ? <span className="design-frames-count" role="status">{selected.length} frames</span> : null}
    {button('Duplicate selection', `${mod}D`, Copy, actions.duplicate, !editable.length)}
    {button(grouped ? 'Ungroup frames' : 'Group frames', `${mod}G`, grouped ? Ungroup : Group, actions.group, !grouped && editable.length < 2)}
    {button('Bring to front', `${mod}Shift+]`, BringToFront, () => actions.stack('front'), !selected.length)}
    {button('Send to back', `${mod}Shift+[`, SendToBack, () => actions.stack('back'), !selected.length)}
    {button(locked ? 'Unlock selection' : 'Lock selection', `${mod}Shift+L`, locked ? LockOpen : Lock, actions.lock, !selected.length)}
    {button('Hide selection', `${mod}Shift+H`, EyeOff, actions.hide, !selected.length)}
  </div>;
}
