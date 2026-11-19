import { useEffect, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Crosshair, Frame, Hand, Minus, MousePointer2, Plus, Smartphone } from 'lucide-react';
import type { DesignFrame } from '@ormicode/protocol';
import type { Rect, View } from './design-model.ts';
import type { DragKind, SnapGuide } from './design-snap.ts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';

export type CanvasTool = 'select' | 'pan';
type Props = {
  canvas: RefObject<HTMLDivElement | null>;
  frames: DesignFrame[];
  selectedFrame: string;
  view: View;
  tool: CanvasTool;
  panning: boolean;
  guides?: SnapGuide[];
  onTool(tool: CanvasTool): void;
  frameRect(frame: DesignFrame): Rect;
  preview(frame: DesignFrame): ReactNode;
  onPointerDown(event: PointerEvent<HTMLDivElement>): void;
  onPointerMove(event: PointerEvent<HTMLDivElement>): void;
  onPointerUp(event: PointerEvent<HTMLDivElement>): void;
  onPointerCancel(event: PointerEvent<HTMLDivElement>): void;
  onWheel(event: WheelEvent): void;
  onDrag(event: PointerEvent, kind: DragKind, frame: DesignFrame): void;
  onNudge(frame: DesignFrame, kind: DragKind, dx: number, dy: number): void;
  onZoom(factor: number): void;
  onFit(): void;
  onFitSelection?: () => void;
  empty?: ReactNode;
  insert?: ReactNode;
};

const arrows: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
const zoomPresets = [25, 50, 75, 100, 150, 200, 300];

export function DesignCanvas(props: Props) {
  const { canvas, onWheel, frames, view, tool, selectedFrame } = props;
  useEffect(() => {
    const area = canvas.current;
    if (!area) return;
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, [canvas, onWheel]);
  return <div className="design-stage">
    <div ref={canvas} aria-label="Design canvas" className="design-canvas" data-tool={tool} data-panning={props.panning}
      onPointerDown={props.onPointerDown} onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp} onPointerCancel={props.onPointerCancel} onLostPointerCapture={props.onPointerCancel}>
      <div className="design-world" style={{ '--design-label-scale': Math.min(2.5, 1 / view.scale), transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } as CSSProperties}>
        {frames.map(frame => {
          const rect = props.frameRect(frame);
          const active = frame.id === selectedFrame;
          const Icon = frame.width < 600 ? Smartphone : Frame;
          const keyboardDrag = (kind: DragKind) => (event: React.KeyboardEvent) => {
            const delta = arrows[event.key];
            if (!delta) return;
            event.preventDefault();
            props.onNudge(frame, kind, ...delta);
          };
          return <div key={frame.id} className="design-artboard" data-selected={active} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
            <button type="button" className="design-artboard-label" aria-label={'Move ' + frame.name + '; use arrow keys to arrange'}
              onPointerDown={event => props.onDrag(event, 'move', frame)} onKeyDown={keyboardDrag('move')}><Icon size={17} /><span>{frame.name}</span></button>
            <div className="design-artboard-preview">{props.preview(frame)}</div>
            <div className="design-artboard-size">{rect.width} × {rect.height}</div>
            {active ? <button type="button" className="design-artboard-handle" aria-label={'Resize ' + frame.name} title="Resize frame"
              onPointerDown={event => props.onDrag(event, 'resize', frame)} onKeyDown={keyboardDrag('resize')} /> : null}
          </div>;
        })}
      </div>
      {props.guides?.map(({ axis, at, from, to }) => {
        const length = (to - from) * view.scale;
        const style = axis === 'x'
          ? { left: view.x + at * view.scale, top: view.y + from * view.scale, height: length, width: 0 }
          : { left: view.x + from * view.scale, top: view.y + at * view.scale, width: length, height: 0 };
        return <div key={axis} aria-hidden className="design-snap-guide" data-axis={axis} style={style} />;
      })}
    </div>
    {props.empty}
    <div className="design-stage-bottom">
      <div className="design-float" role="group" aria-label="Canvas tools">
        <button className="design-icon-button" type="button" title="Select" aria-label="Select tool" aria-pressed={tool === 'select'} onClick={() => props.onTool('select')}><MousePointer2 size={16} /></button>
        <button className="design-icon-button" type="button" title="Pan" aria-label="Pan tool" aria-pressed={tool === 'pan'} onClick={() => props.onTool('pan')}><Hand size={16} /></button>
        {props.insert ? <><span className="design-divider" />{props.insert}</> : null}
      </div>
      <div className="design-float" role="group" aria-label="Zoom controls">
        <button className="design-icon-button" type="button" title="Zoom out" aria-label="Zoom out" onClick={() => props.onZoom(1 / 1.2)}><Minus size={15} /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="design-button design-zoom-menu" aria-label="Canvas zoom">
            {Math.round(view.scale * 100)}% <ChevronDown size={12} />
          </button></DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="design-property-popup design-zoom-options">
            <DropdownMenuItem disabled={!props.onFitSelection} onSelect={props.onFitSelection}>Fit selection</DropdownMenuItem>
            <DropdownMenuSeparator />
            {zoomPresets.map(percent => <DropdownMenuItem key={percent} onSelect={() => props.onZoom(percent / 100 / view.scale)}>{percent}%</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <button className="design-icon-button" type="button" title="Zoom in" aria-label="Zoom in" onClick={() => props.onZoom(1.2)}><Plus size={15} /></button>
        <span className="design-divider" />
        <button className="design-icon-button" type="button" title="Fit all frames" aria-label="Fit all frames" onClick={props.onFit}><Crosshair size={15} /></button>
      </div>
    </div>
  </div>;
}
