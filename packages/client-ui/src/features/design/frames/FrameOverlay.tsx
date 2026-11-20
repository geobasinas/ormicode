import { RotateCw } from 'lucide-react';
import type { DesignFrame } from '@ormicode/protocol';
import type { Rect } from '../design-model.ts';
import type { DesignFrames } from './useDesignFrames.ts';

/** Selection bounds, batch resize/rotate handles and marquee, drawn in canvas world coordinates. */
export function FrameOverlay({ frames, frameRect }: {
  frames: DesignFrames;
  frameRect(frame: DesignFrame): Rect & { rotation?: number };
}) {
  const { bounds, gestures, editable, ids } = frames;
  const marquee = gestures.marquee;
  const single = ids.length === 1 && editable[0] ? frameRect(editable[0]) : undefined;
  const rect = single ?? bounds;
  const rotation = single?.rotation;
  return <>
    {rect ? <div className="design-frames-bounds" data-multiple={ids.length > 1}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, transform: rotation ? `rotate(${rotation}deg)` : undefined }}>
      <button type="button" className="design-transform-handle design-frames-rotate" title="Rotate (Shift snaps to 15°)" aria-label={`Rotate ${editable.length} selected frame${editable.length === 1 ? '' : 's'}`}
        onPointerDown={event => frames.startHandle(event, 'rotate')}><RotateCw size={13} aria-hidden="true" style={rotation ? { rotate: `${-rotation}deg` } : undefined} /></button>
      {ids.length > 1 ? <button type="button" className="design-transform-handle design-frames-resize" title="Resize selection (Shift keeps proportions)" aria-label="Resize selected frames"
        onPointerDown={event => frames.startHandle(event, 'resize')} /> : null}
    </div> : null}
    {marquee ? <div aria-hidden className="design-frames-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
  </>;
}
