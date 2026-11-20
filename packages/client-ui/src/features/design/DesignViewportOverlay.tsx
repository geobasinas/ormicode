import { useRef, useState, type PointerEvent } from 'react';
import type { DesignOperation, DesignPage } from '@ormicode/protocol';
import type { View } from './design-model.ts';
import { gridStep, guideAxisFromRuler, isGuideRemoval, rulerTicks, screenToDocument } from './design-rulers.ts';
import './design-viewport.css';

export function useViewportOptions() {
  const [options, setOptions] = useState(() => {
    try { return { rulers: true, guides: true, grid: false, ...JSON.parse(localStorage.getItem('design-viewport') ?? '{}') } as Record<'rulers' | 'guides' | 'grid', boolean>; }
    catch { return { rulers: true, guides: true, grid: false }; }
  });
  return { options, toggle: (key: keyof typeof options) => setOptions(current => {
    const next = { ...current, [key]: !current[key] };
    try { localStorage.setItem('design-viewport', JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
    return next;
  }) };
}

type Props = { page: DesignPage; view: View; width: number; height: number; preferences: ReturnType<typeof useViewportOptions>; disabled: boolean; act(operation: DesignOperation): void };
export function DesignViewportOverlay({ page, view, width, height, preferences, disabled, act }: Props) {
  const { options, toggle } = preferences;
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ axis: 'x' | 'y'; id?: string; at: number } | null>(null);
  const coordinate = (event: PointerEvent, axis: 'x' | 'y') => {
    const box = root.current!.getBoundingClientRect();
    return (axis === 'x' ? event.clientX - box.left : event.clientY - box.top);
  };
  const at = (event: PointerEvent, axis: 'x' | 'y') => Math.max(-100000, Math.min(100000, Math.round(screenToDocument(coordinate(event, axis), view[axis], view.scale))));
  const begin = (event: PointerEvent, axis: 'x' | 'y', id?: string) => {
    event.stopPropagation();
    if (disabled || event.button !== 0 || (!id && (page.guides?.length ?? 0) >= 40)) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ axis, id, at: at(event, axis) });
  };
  const end = (event: PointerEvent) => {
    if (!drag) return;
    event.stopPropagation();
    const remove = isGuideRemoval(drag.axis, { x: coordinate(event, 'x'), y: coordinate(event, 'y') }, options.rulers);
    if (remove && drag.id) act({ type: 'guide.remove', pageId: page.id, guideId: drag.id });
    else if (!remove) act(drag.id ? { type: 'guide.move', pageId: page.id, guideId: drag.id, at: at(event, drag.axis) } : { type: 'guide.add', pageId: page.id, axis: drag.axis, at: at(event, drag.axis) });
    setDrag(null);
  };
  const step = gridStep(view.scale) * view.scale;
  const guides = (page.guides ?? []).map(guide => guide.id === drag?.id ? { ...guide, at: drag.at } : guide);
  return <div ref={root} className="design-viewport" data-dragging={Boolean(drag)} onPointerDown={event => event.stopPropagation()}
    onPointerMove={event => { if (drag) { event.stopPropagation(); setDrag({ ...drag, at: at(event, drag.axis) }); } }}
    onPointerUp={end} onPointerCancel={() => setDrag(null)}>
    {options.grid && <div className="design-document-grid" style={{ backgroundSize: `${step}px ${step}px`, backgroundPosition: `${view.x}px ${view.y}px` }} />}
    {options.rulers && (['x', 'y'] as const).map(axis => <div key={axis} className="design-ruler" data-axis={axis} title="Drag to create guide" onPointerDown={event => begin(event, guideAxisFromRuler(axis))}>
      {rulerTicks(axis === 'x' ? width : height, view[axis], view.scale).map(tick => <span key={tick.at} data-major={tick.major} style={axis === 'x' ? { left: tick.screen } : { top: tick.screen }}>{tick.major ? Number(tick.at.toFixed(2)) : ''}</span>)}
    </div>)}
    {options.guides && [...guides, ...(drag && !drag.id ? [{ ...drag, id: 'preview' }] : [])].map(guide => <div key={guide.id} role="separator" aria-label={`${guide.axis} guide at ${guide.at}`} className="design-page-guide" data-axis={guide.axis}
      style={guide.axis === 'x' ? { left: view.x + guide.at * view.scale } : { top: view.y + guide.at * view.scale }} onPointerDown={event => begin(event, guide.axis, guide.id)} />)}
    <div className="design-viewport-options">{(['rulers', 'guides', 'grid'] as const).map(key => <button key={key} aria-pressed={options[key]} onClick={() => toggle(key)}>{key}</button>)}</div>
  </div>;
}
