import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, MapPin, Pencil, Square, Trash2, Undo2, X } from 'lucide-react';
import { browserPrimaryButton } from './browser-ui.tsx';
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
      const badge = item.kind === 'box' && item.points[1]
        ? { x: Math.min(first.x, item.points[1].x), y: Math.min(first.y, item.points[1].y) }
        : first;
      ctx.beginPath(); ctx.arc(badge.x * sx, badge.y * sy, 10 * Math.max(sx, sy), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = badgeText; ctx.font = `${11 * Math.max(sx, sy)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(item.index), badge.x * sx, badge.y * sy); ctx.restore();
      if (item.comment) {
        ctx.save(); ctx.font = `${12 * Math.max(sx, sy)}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const label = `${item.index}. ${item.comment.slice(0, 90)}`;
        const x = Math.min(target.width - 220 * sx, Math.max(0, badge.x * sx + 14 * sx));
        const labelHeight = 22 * sy; const gap = 4 * sy;
        const boxTop = item.kind === 'box' && item.points[1] ? Math.min(first.y, item.points[1].y) * sy : undefined;
        const boxBottom = item.kind === 'box' && item.points[1] ? Math.max(first.y, item.points[1].y) * sy : undefined;
        const labelY = boxTop === undefined || boxBottom === undefined ? badge.y * sy + 18 * sy
          : boxTop >= labelHeight + gap ? boxTop - gap - labelHeight / 2 : boxBottom + gap + labelHeight / 2;
        const y = Math.min(target.height - labelHeight / 2, Math.max(labelHeight / 2, labelY));
        const maxWidth = Math.max(1, Math.min(220 * sx, target.width - x));
        const textWidth = Math.max(1, maxWidth - 12 * sx);
        let shown = label;
        while (shown.length > 1 && ctx.measureText(shown).width > textWidth) shown = `${shown.slice(0, -2).trimEnd()}…`;
        ctx.fillStyle = panel; ctx.fillRect(x, y - labelHeight / 2, Math.min(maxWidth, ctx.measureText(shown).width + 12 * sx), labelHeight);
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
      <button type="button" title="Box" aria-pressed={tool === 'box'} onClick={() => setTool('box')} style={iconStyle(tool === 'box')}><Square size={14} /></button>
      <button type="button" title="Freehand pen" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} style={iconStyle(tool === 'pen')}><Pencil size={14} /></button>
      <button type="button" title="Pin comment" aria-pressed={tool === 'pin'} onClick={() => setTool('pin')} style={iconStyle(tool === 'pin')}><MapPin size={14} /></button>
      <span style={{ width: 1, height: 18, background: 'var(--line-card)', margin: '0 3px' }} />
      <button type="button" title="Undo" disabled={!items.length} onClick={() => setItems(current => current.slice(0, -1))} style={iconStyle(false)}><Undo2 size={14} /></button>
      <button type="button" title="Clear" disabled={!items.length} onClick={() => { setItems([]); setEditing(undefined); }} style={iconStyle(false)}><Trash2 size={13} /></button>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={() => { setDone(true); setEditing(undefined); }} style={{ ...iconStyle(false), width: 'auto', padding: '0 8px', fontSize: 10.5 }}><Check size={12} />Done</button>
    </div>
    <div ref={stage} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: frame.pageWidth * scale, height: frame.pageHeight * scale, maxWidth: '100%', maxHeight: '100%', border: '1px solid var(--line-card)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px var(--shadow-color)' }}>
        <canvas ref={canvas} width={frame.pixelWidth} height={frame.pixelHeight}
          onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: done ? 'default' : tool === 'pin' ? 'crosshair' : 'crosshair' }} />
        {edit && anchor ? <div style={{ position: 'absolute', left: Math.min(Math.max(0, frame.pageWidth * scale - 216), anchor.x * scale), top: Math.min(Math.max(0, frame.pageHeight * scale - 72), anchor.y * scale), zIndex: 2, width: 210, padding: 6, border: '1px solid var(--line-card)', borderRadius: 7, background: 'var(--bg-raised)', boxShadow: '0 8px 24px var(--shadow-color)' }}>
          <textarea autoFocus value={edit.comment} placeholder={`Comment ${edit.index}…`} onChange={event => updateComment(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); setEditing(undefined); } }}
            style={{ width: '100%', minHeight: 48, resize: 'vertical', border: 0, outline: 0, background: 'transparent', color: 'var(--text-label)', font: 'inherit', fontSize: 11 }} />
          <button type="button" onClick={() => setEditing(undefined)} style={{ ...iconStyle(false), float: 'right', width: 22, height: 20 }}><X size={12} /></button>
        </div> : null}
      </div>
    </div>
    <footer style={{ minHeight: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-raised)', borderTop: '1px solid var(--line-card)' }}>
      <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 10.5 }}>{items.length} {items.length === 1 ? 'comment' : 'comments'}</span>
      <button type="button" disabled={!items.length} onClick={() => void submit(true)} style={browserPrimaryButton}>Send to agent</button>
      <button type="button" disabled={!items.length} onClick={() => void submit(false)} style={{ ...browserPrimaryButton, background: 'var(--bg-selected)', color: 'var(--text-label)' }}>Add to composer</button>
      <button type="button" title="Discard annotations" onClick={() => { try { localStorage.removeItem(storageKey); } catch {} onDiscard(); }}
        style={{ ...iconStyle(false), width: 'auto', padding: '0 5px', gap: 4, fontSize: 10.5 }}><X size={13} />Discard</button>
    </footer>
  </div>;
}
