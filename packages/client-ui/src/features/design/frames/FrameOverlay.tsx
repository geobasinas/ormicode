import type { DesignFrames } from './useDesignFrames.ts';

/** Selection bounds, batch resize/rotate handles and marquee, drawn in canvas world coordinates. */
export function FrameOverlay({ frames }: { frames: DesignFrames }) {
  const { bounds, gestures, editable, ids } = frames;
  const marquee = gestures.marquee;
  return <>
    {bounds ? <div className="design-frames-bounds" data-multiple={ids.length > 1} style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
      <button type="button" className="design-frames-rotate" title="Rotate (Shift snaps to 15°)" aria-label={`Rotate ${editable.length} selected frame${editable.length === 1 ? '' : 's'}`}
        onPointerDown={event => frames.startHandle(event, 'rotate')} />
      {ids.length > 1 ? <button type="button" className="design-frames-resize" title="Resize selection (Shift keeps proportions)" aria-label="Resize selected frames"
        onPointerDown={event => frames.startHandle(event, 'resize')} /> : null}
    </div> : null}
    {marquee ? <div aria-hidden className="design-frames-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
  </>;
}
