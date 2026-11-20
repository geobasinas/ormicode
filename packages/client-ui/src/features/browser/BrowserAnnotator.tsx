import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, MapPin, Pencil, Square, Trash2, Undo2, X } from 'lucide-react';
import { BrowserIconButton, BrowserTooltip, browserPrimaryButton } from './browser-ui.tsx';
import { annotationEditorPosition, annotationLabelCenterY, annotationLabelLeft } from './annotation-geometry.ts';
import type { Annotation, PreviewFrame } from './useBrowserInspector.ts';

type Tool = Annotation['kind'];
type Props = {
  frame: PreviewFrame; storageKey: string;
  onSubmit: (items: Annotation[], image: { data: string; url: string; size: number }, send: boolean) => Promise<void>;
  onDiscard: () => void;
};

function saved(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' ? value as { frame?: PreviewFrame; items?: Annotation[] } : {};
  }
  catch { return {}; }
}

export function BrowserAnnotator({ frame: initialFrame, storageKey, onSubmit, onDiscard }: Props) {
  const initial = useRef(saved(storageKey));
  const frame = initial.current.frame ?? initialFrame;
  const [items, setItems] = useState<Annotation[]>(initial.current.items ?? []);
  const [tool, setTool] = useState<Tool>('box');
  const [drawing, setDrawing] = useState<Annotation>();
  const [editing, setEditing] = useState<string>();
  const [done, setDone] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [stageSize, setStageSize] = useState([0, 0]);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const scale = Math.min(
    stageSize[0] / frame.pageWidth || 1,
    stageSize[1] / frame.pageHeight || 1,
  );

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStageSize([element.clientWidth, element.clientHeight]));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!editing) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setEditing(undefined);
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [editing]);
  useEffect(() => {
    const base = new Image();
    base.onload = () => { image.current = base; setImageLoaded(true); };
    base.src = frame.image;
  }, [frame.image]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ frame, items })); }
    catch { try { localStorage.setItem(storageKey, JSON.stringify({ items })); } catch {} }
  }, [frame, items, storageKey]);

  const render = useCallback(() => {
    const target = canvas.current;
    const ctx = target?.getContext('2d');
    if (!target || !ctx || !image.current) return;
    const sx = target.width / frame.pageWidth; const sy = target.height / frame.pageHeight;
    const theme = getComputedStyle(document.documentElement);
    const color = theme.getPropertyValue('--accent-red').trim() || theme.color;
    const panel = theme.getPropertyValue('--bg-raised').trim() || theme.backgroundColor;
    const labelColor = theme.getPropertyValue('--text-label').trim() || theme.color;
    const labelBorder = theme.getPropertyValue('--line-card').trim() || theme.color;
    const badgeText = theme.getPropertyValue('--text-onAccent').trim() || theme.color;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(image.current, 0, 0, target.width, target.height);
    for (const item of [...items, ...(drawing ? [drawing] : [])]) {
      const first = item.points[0]; if (!first) continue;
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2 * Math.max(sx, sy);
      if (item.kind === 'box' && item.points[1]) {
        const last = item.points[1]; const x = Math.min(first.x, last.x) * sx; const y = Math.min(first.y, last.y) * sy;
        const w = Math.abs(first.x - last.x) * sx; const h = Math.abs(first.y - last.y) * sy;
        ctx.globalAlpha = 0.12; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h);
      } else if (item.kind === 'pen') {
        ctx.beginPath(); ctx.moveTo(first.x * sx, first.y * sy);
        item.points.slice(1).forEach(point => ctx.lineTo(point.x * sx, point.y * sy)); ctx.stroke();
      }
      const isBox = item.kind === 'box' && item.points[1];
      const labelHeight = 22 * sy; const gap = 4 * sy; const badgeRadius = 10 * Math.max(sx, sy);
      const boxTop = isBox ? Math.min(first.y, item.points[1]!.y) * sy : undefined;
      const boxBottom = isBox ? Math.max(first.y, item.points[1]!.y) * sy : undefined;
      const labelY = boxTop === undefined || boxBottom === undefined ? first.y * sy + 18 * sy
        : annotationLabelCenterY(boxTop, boxBottom, labelHeight, gap, badgeRadius, target.height);
      const badgeX = isBox ? Math.min(first.x, item.points[1]!.x) * sx : first.x * sx;
      const badge = {
        x: Math.max(badgeRadius, Math.min(target.width - badgeRadius, badgeX)),
        y: isBox ? labelY : first.y * sy,
      };
      ctx.beginPath(); ctx.arc(badge.x, badge.y, badgeRadius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = badgeText; ctx.font = `${11 * Math.max(sx, sy)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(item.index), badge.x, badge.y); ctx.restore();
      if (item.comment) {
        ctx.save(); ctx.font = `${12 * Math.max(sx, sy)}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const label = `${item.index}. ${item.comment.slice(0, 90)}`;
        const inset = Math.max(1, sx);
        const maxWidth = Math.max(1, Math.min(220 * sx, target.width - inset * 2));
        const textWidth = Math.max(1, maxWidth - 12 * sx);
        let shown = label;
        while (shown.length > 1 && ctx.measureText(shown).width > textWidth) shown = `${shown.slice(0, -2).trimEnd()}…`;
        const labelWidth = Math.min(maxWidth, ctx.measureText(shown).width + 12 * sx);
        const x = annotationLabelLeft(badge.x + 14 * sx, labelWidth, target.width, inset);
        const y = Math.min(target.height - labelHeight / 2, Math.max(labelHeight / 2, labelY));
        ctx.fillStyle = panel; ctx.fillRect(x, y - labelHeight / 2, labelWidth, labelHeight);
        ctx.strokeStyle = labelBorder; ctx.lineWidth = Math.max(1, sx); ctx.strokeRect(x, y - labelHeight / 2, labelWidth, labelHeight);
        ctx.fillStyle = labelColor; ctx.fillText(shown, x + 6 * sx, y, textWidth); ctx.restore();
      }
    }
  }, [drawing, frame.pageHeight, frame.pageWidth, items]);
  useEffect(() => { render(); }, [render, stageSize, frame.image, imageLoaded]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * frame.pageWidth / rect.width, y: (event.clientY - rect.top) * frame.pageHeight / rect.height };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (done) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event);
    const next: Annotation = { id: crypto.randomUUID(), index: items.length + 1, kind: tool, points: [at], comment: '' };
    if (tool === 'pin') { setItems(current => [...current, next]); setEditing(next.id); }
    else setDrawing(next);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const at = point(event);
    setDrawing(current => current ? { ...current, points: current.kind === 'box' ? [current.points[0]!, at] : [...current.points, at] } : current);
  };
  const stop = () => {
    if (!drawing) return;
    if (drawing.kind === 'box' && drawing.points[1] && (Math.abs(drawing.points[0]!.x - drawing.points[1].x) + Math.abs(drawing.points[0]!.y - drawing.points[1].y) < 5)) { setDrawing(undefined); return; }
    setItems(current => [...current, drawing]); setEditing(drawing.id); setDrawing(undefined);
  };
  const edit = items.find(item => item.id === editing);
  const anchor = edit?.points[0];
  const editorWidth = 216;
  const editorHeight = 120;
  const editorPosition = anchor ? annotationEditorPosition(
    anchor.x * scale, anchor.y * scale, frame.pageWidth * scale, frame.pageHeight * scale, editorWidth, editorHeight,
  ) : undefined;
  const updateComment = (value: string) => setItems(current => current.map(item => item.id === editing ? { ...item, comment: value } : item));

  const submit = async (send: boolean) => {
    const source = canvas.current;
    if (!source || !items.length) return;
    let url = source.toDataURL('image/png');
    let data = url.split(',')[1] ?? '';
    let size = Math.floor(data.length * 0.75);
    let ratio = 0.85;
    while (size > 2 * 1024 * 1024 && source.width * ratio > 2 && source.height * ratio > 2) {
      const resized = document.createElement('canvas');
      resized.width = Math.max(1, Math.floor(source.width * ratio));
      resized.height = Math.max(1, Math.floor(source.height * ratio));
      resized.getContext('2d')?.drawImage(source, 0, 0, resized.width, resized.height);
      url = resized.toDataURL('image/png'); data = url.split(',')[1] ?? ''; size = Math.floor(data.length * 0.75); ratio *= 0.75;
    }
    await onSubmit(items, { data, url, size }, send);
    try { localStorage.removeItem(storageKey); } catch {}
  };

  const iconStyle = (selected: boolean) => ({ width: 27, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: selected ? 'var(--bg-selected)' : 'transparent', color: selected ? 'var(--text-active)' : 'var(--text-secondary)', cursor: 'pointer' });
  return <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--bg-inset)' }}>
    <div style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 7px', background: 'var(--bg-raised)', borderBottom: '1px solid var(--line-card)' }}>
      <BrowserTooltip label="Box"><button type="button" aria-label="Box" aria-pressed={tool === 'box'} onClick={() => setTool('box')} style={iconStyle(tool === 'box')}><Square size={14} /></button></BrowserTooltip>
      <BrowserTooltip label="Freehand pen"><button type="button" aria-label="Freehand pen" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} style={iconStyle(tool === 'pen')}><Pencil size={14} /></button></BrowserTooltip>
      <BrowserTooltip label="Pin comment"><button type="button" aria-label="Pin comment" aria-pressed={tool === 'pin'} onClick={() => setTool('pin')} style={iconStyle(tool === 'pin')}><MapPin size={14} /></button></BrowserTooltip>
      <span style={{ width: 1, height: 18, background: 'var(--line-card)', margin: '0 3px' }} />
      <BrowserIconButton title="Undo" disabled={!items.length} onClick={() => setItems(current => current.slice(0, -1))}><Undo2 size={14} /></BrowserIconButton>
      <BrowserIconButton title="Clear annotations" disabled={!items.length} onClick={() => { setItems([]); setEditing(undefined); }}><Trash2 size={13} /></BrowserIconButton>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={() => { setDone(true); setEditing(undefined); }} className="hv-sub" style={{ ...iconStyle(false), width: 'auto', padding: '0 8px', fontSize: 10.5 }}><Check size={12} />Done</button>
    </div>
    <div ref={stage} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: frame.pageWidth * scale, height: frame.pageHeight * scale, maxWidth: '100%', maxHeight: '100%', border: '1px solid var(--line-card)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px var(--shadow-color)' }}>
        <canvas ref={canvas} width={frame.pixelWidth} height={frame.pixelHeight}
          onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: done ? 'default' : tool === 'pin' ? 'crosshair' : 'crosshair' }} />
        {edit && editorPosition ? <div style={{ position: 'absolute', left: editorPosition.left, top: editorPosition.top, zIndex: 2, width: editorWidth, height: editorHeight, boxSizing: 'border-box', padding: 9, border: '1px solid var(--line-card)', borderRadius: 8, background: 'var(--bg-raised)', boxShadow: '0 8px 24px var(--shadow-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ flex: 1, color: 'var(--text-label)', fontSize: 10.5, fontWeight: 600 }}>Comment {edit.index}</span>
          </div>
          <textarea autoFocus aria-label={`Comment ${edit.index}`} value={edit.comment} placeholder="Add a note for this marked area…" onChange={event => updateComment(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); setEditing(undefined); } }}
            style={{ width: '100%', minHeight: 52, resize: 'vertical', border: '1px solid var(--line-subtle)', borderRadius: 6, padding: 6, background: 'var(--bg-main)', color: 'var(--text-label)', font: 'inherit', fontSize: 11 }} />
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 4, color: 'var(--text-hint)', fontSize: 9.5 }}>
            <span style={{ flex: 1 }}>Save · Enter</span><BrowserIconButton title="Close comment editor" onClick={() => setEditing(undefined)}><X size={12} /></BrowserIconButton>
          </div>
        </div> : null}
      </div>
    </div>
    <footer style={{ minHeight: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-raised)', borderTop: '1px solid var(--line-card)' }}>
      <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 10.5 }}>{items.length} {items.length === 1 ? 'comment' : 'comments'}</span>
      <button type="button" disabled={!items.length} onClick={() => void submit(false)} className="hv-sub"
        style={{ height: 28, padding: '0 9px', border: '1px solid var(--line-card)', borderRadius: 7, background: 'var(--bg-card)', color: 'var(--text-label)', fontSize: 11, cursor: 'pointer' }}>Add to composer</button>
      <button type="button" disabled={!items.length} onClick={() => void submit(true)} style={{ ...browserPrimaryButton, padding: '7px 10px', fontSize: 11 }}>Send to agent</button>
      <BrowserTooltip label="Discard annotations"><button type="button" aria-label="Discard annotations" onClick={() => { try { localStorage.removeItem(storageKey); } catch {} onDiscard(); }}
        className="hv-sub" style={{ ...iconStyle(false), width: 'auto', padding: '0 5px', gap: 4, fontSize: 10.5 }}><X size={13} />Discard</button></BrowserTooltip>
    </footer>
  </div>;
}
