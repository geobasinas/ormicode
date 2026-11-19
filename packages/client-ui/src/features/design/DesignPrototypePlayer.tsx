import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Crosshair, Play, RotateCcw, X } from 'lucide-react';
import type { DesignDocument, DesignPage, DesignPrototypeAction } from '@ormicode/protocol';
import { startFrameOf } from './design-pages.ts';
import { DesignPrototypeScreen } from './DesignPrototypeScreen.tsx';

export function DesignPrototypeLauncher({ document, page, tokenStyles, disabled }: {
  document: DesignDocument | null; page: DesignPage; tokenStyles: string; disabled: boolean;
}) {
  const start = document && startFrameOf(page, document.frames);
  const [playing, setPlaying] = useState(false);
  return <>
    <button className="design-button" type="button" disabled={disabled || !start} onClick={() => setPlaying(true)}><Play size={14} /> Play prototype</button>
    {playing && document && <DesignPrototypePlayer document={document} page={page} tokenStyles={tokenStyles} onClose={() => setPlaying(false)} />}
  </>;
}

function DesignPrototypePlayer({ document, page, tokenStyles, onClose }: {
  document: DesignDocument; page: DesignPage; tokenStyles: string; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hints, setHints] = useState(false);
  const [error, setError] = useState('');
  const start = startFrameOf(page, document.frames);
  const [flow, setFlow] = useState({ frameId: start?.id ?? '', overlayId: '', history: [] as string[], visit: 0 });
  const find = (id: string) => document.frames.find(frame => frame.id === id && !frame.hidden);
  const frame = find(flow.frameId) ?? start;
  const overlay = frame && find(flow.overlayId);
  const previous = flow.history.findLastIndex(id => id !== frame?.id && find(id));
  const back = () => {
    if (overlay) setFlow({ ...flow, overlayId: '' });
    else if (previous >= 0) setFlow({ frameId: flow.history[previous]!, overlayId: '', history: flow.history.slice(0, previous), visit: flow.visit + 1 });
    setError('');
  };
  const escape = () => { if (overlay) back(); else onClose(); };
  const act = (action: DesignPrototypeAction) => {
    if (action === 'back') { back(); return; }
    if (action === 'close-overlay') { if (overlay) back(); return; }
    const [kind, targetId] = action.split(':');
    const target = targetId && find(targetId);
    if (!target || !frame) { setError('This link points to an unavailable frame.'); return; }
    setError('');
    if (kind === 'overlay') setFlow({ ...flow, overlayId: target.id });
    else if (target.id !== frame.id || overlay) setFlow({ frameId: target.id, overlayId: '', visit: flow.visit + 1,
      history: target.id === frame.id ? flow.history : [...flow.history, frame.id].slice(-50) });
  };
  useLayoutEffect(() => {
    const modal = dialog.current!;
    const viewport = stage.current!;
    modal.showModal();
    const measure = () => setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => { observer.disconnect(); modal.close(); };
  }, []);
  const fit = (width: number, height: number) => Math.max(0.01, Math.min(1, (size.width - 48) / width, (size.height - 48) / height));
  const scale = frame ? fit(frame.width, frame.height) : 1;

  return <dialog ref={dialog} className="design-prototype-player" aria-label="Prototype player"
    onCancel={event => { event.preventDefault(); escape(); }} onKeyDown={event => event.stopPropagation()}>
    <header className="design-prototype-toolbar">
      <strong>Prototype</strong>
      <div role="status" className="design-prototype-location">{frame ? [frame.name, overlay?.name].filter(Boolean).join(' / ') : 'No visible frames'}</div>
      <div className="design-prototype-controls">
        <button className="design-icon-button" type="button" title="Back" aria-label="Back" disabled={!overlay && previous < 0} onClick={back}><ArrowLeft size={16} /></button>
        <button className="design-icon-button" type="button" title="Restart" aria-label="Restart" disabled={!start}
          onClick={() => { if (start) setFlow({ frameId: start.id, overlayId: '', history: [], visit: flow.visit + 1 }); setError(''); }}><RotateCcw size={16} /></button>
        <button className="design-icon-button" type="button" title="Show hotspots" aria-label="Show hotspots" aria-pressed={hints} onClick={() => setHints(value => !value)}><Crosshair size={17} /></button>
        <button className="design-button" type="button" onClick={onClose}><X size={16} /> Exit</button>
      </div>
    </header>
    <div ref={stage} className="design-prototype-stage">
      {frame && <DesignPrototypeScreen key={frame.id + ':' + flow.visit} frame={frame} scale={scale}
        tokenStyles={tokenStyles} active={!overlay} hints={hints} onAction={act} onEscape={escape} />}
      {overlay && <div className="design-prototype-overlay">
        <button className="design-prototype-scrim" type="button" aria-label="Dismiss overlay" onClick={back} />
        <DesignPrototypeScreen key={overlay.id} frame={overlay} scale={Math.min(scale, fit(overlay.width, overlay.height))}
          tokenStyles={tokenStyles} active hints={hints} onAction={act} onEscape={escape} />
      </div>}
      {error && <div className="design-prototype-error" role="alert">{error}</div>}
    </div>
  </dialog>;
}
