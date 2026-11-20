import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import type { DesignFrame } from '@ormicode/protocol';

/** Per-frame lock and visibility toggles shown in the layers list. */
export function FrameLayerControls({ frame, disabled, onToggle }: { frame: DesignFrame; disabled: boolean; onToggle(frame: DesignFrame, key: 'locked' | 'hidden'): void }) {
  const LockIcon = frame.locked ? Lock : LockOpen; const EyeIcon = frame.hidden ? EyeOff : Eye;
  return <span className="design-frame-layer-controls" data-pinned={!!(frame.locked || frame.hidden)}>
    <button className="design-icon-button" type="button" disabled={disabled} aria-pressed={!!frame.locked} title={frame.locked ? 'Unlock' : 'Lock'}
      aria-label={(frame.locked ? 'Unlock ' : 'Lock ') + frame.name} onClick={() => onToggle(frame, 'locked')}><LockIcon size={13} /></button>
    <button className="design-icon-button" type="button" disabled={disabled} aria-pressed={!!frame.hidden} title={frame.hidden ? 'Show' : 'Hide'}
      aria-label={(frame.hidden ? 'Show ' : 'Hide ') + frame.name} onClick={() => onToggle(frame, 'hidden')}><EyeIcon size={13} /></button>
  </span>;
}
