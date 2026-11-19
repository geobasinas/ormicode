import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { usePlatform } from '../../lib/platform.ts';
import type { CheckpointScreenshotChoice } from './checkpoint-preview.ts';

type Mode = 'side-by-side' | 'slider' | 'diff';
type DiffResult = { artifact: string; changed: number; total: number; percent: number; width: number; height: number; src: string };

export function CheckpointCompareDialog({ open, onClose, session, choices, initialA, initialB, busy, onRestore, onFork }: {
  open: boolean; onClose(): void; session: string; choices: CheckpointScreenshotChoice[];
  initialA: string; initialB: string; busy: boolean;
  onRestore(id: string): void; onFork(id: string): void;
}) {
  const { transport } = usePlatform();
  const [mode, setMode] = useState<Mode>('side-by-side');
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [slider, setSlider] = useState(50);
  const [diff, setDiff] = useState<DiffResult>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    setA(initialA);
    setB(initialB);
  }, [initialA, initialB]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const id of new Set([a, b])) {
      const choice = choices.find(item => item.id === id);
      if (!choice || requested.current.has(id)) continue;
      requested.current.add(id);
      void transport.request('browser.artifact', { session, id: choice.artifact }).then(result => {
        const body = result.type === 'res' ? result.body as { mime: string; data: string } : undefined;
        setImages(current => ({ ...current, [id]: body ? `data:${body.mime};base64,${body.data}` : '' }));
        setLoaded(true);
      }).catch(() => {
        setImages(current => ({ ...current, [id]: '' }));
        setLoaded(true);
      });
    }
  }, [open, a, b, choices, session, transport]);

  useEffect(() => {
    if (!open || mode !== 'diff') return;
    const first = choices.find(item => item.id === a);
    const second = choices.find(item => item.id === b);
    if (!first || !second) return;
    let alive = true;
    setDiff(undefined);
    setDiffLoading(true);
    setError('');
    void transport.request('browser.diff', { session, a: first.artifact, b: second.artifact }).then(async result => {
      if (result.type === 'err') throw new Error(String(result.message ?? result.code));
      const body = result.body as Omit<DiffResult, 'src'>;
      const artifact = await transport.request('browser.artifact', { session, id: body.artifact });
      if (artifact.type === 'err') throw new Error(String(artifact.message ?? artifact.code));
      if (alive) {
        const image = artifact.body as { mime: string; data: string };
        setDiff({ ...body, src: `data:${image.mime};base64,${image.data}` });
      }
    }).catch(cause => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (alive) setDiffLoading(false); });
    return () => { alive = false; };
  }, [open, mode, a, b, choices, session, transport]);

  if (!open) return null;
  const selectedA = choices.find(item => item.id === a);
  const selectedB = choices.find(item => item.id === b);
  const setFromPointer = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (rect?.width) setSlider(Math.max(0, Math.min(100, Math.round((clientX - rect.left) * 100 / rect.width))));
  };
  const keySlider = (key: string) => {
    if (key === 'ArrowLeft') setSlider(value => Math.max(0, value - 5));
    if (key === 'ArrowRight') setSlider(value => Math.min(100, value + 5));
  };

  return <div role="dialog" aria-modal="true" aria-label="Compare checkpoints" tabIndex={-1} ref={dialogRef}
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
    style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000a', display: 'grid', placeItems: 'center', padding: 24, outline: 'none' }}>
    <div style={{ width: 'min(1100px, 94vw)', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg-raised)', color: 'var(--text-active)', border: '1px solid var(--line-card)', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Compare checkpoints</strong>
        <button type="button" aria-label="Close comparison" onClick={onClose} style={iconButton}><X size={14} /></button>
      </div>
      <div role="group" aria-label="Comparison mode" style={{ display: 'inline-flex', padding: 2, borderRadius: 7, background: 'var(--bg-inset)', border: '1px solid var(--line-card)', marginBottom: 10 }}>
        {([
          ['side-by-side', 'Side by side'], ['slider', 'Slider'], ['diff', 'Diff'],
        ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}
          className="focus-visible:ring-2 focus-visible:ring-ring"
          style={{ border: 0, borderRadius: 5, padding: '5px 9px', background: mode === value ? 'var(--bg-selected)' : 'transparent', color: mode === value ? 'var(--text-title)' : 'var(--text-secondary)', font: 'inherit', fontSize: 11, cursor: 'pointer' }}>
          {label}
        </button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <CheckpointPicker side="A" value={a} options={choices} onChange={setA} />
        <CheckpointPicker side="B" value={b} options={choices} onChange={setB} />
      </div>

      {mode === 'side-by-side' ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[[a, selectedA], [b, selectedB]].map(([id, choice]) => {
          const value = String(id);
          const item = choice as CheckpointScreenshotChoice | undefined;
          return <div key={value} style={{ display: 'grid', gap: 6 }}>
            <ImageFrame source={images[value]} label={item?.label ?? 'Checkpoint'} />
            <CheckpointActions id={value} disabled={busy || !item} onRestore={onRestore} onFork={onFork} />
          </div>;
        })}
      </div> : null}

      {mode === 'slider' ? <div style={{ display: 'grid', gap: 6 }}>
        <div ref={frameRef} style={{ position: 'relative', width: '100%', height: 'min(58vh, 520px)', minHeight: 240, overflow: 'hidden', background: 'var(--bg-inset)', borderRadius: 6, touchAction: 'none' }}>
          <img alt={`Checkpoint A: ${selectedA?.label ?? ''}`} src={images[a] || undefined} style={stackedImage} />
          <img alt={`Checkpoint B: ${selectedB?.label ?? ''}`} src={images[b] || undefined}
            style={{ ...stackedImage, clipPath: `inset(0 ${100 - slider}% 0 0)` }} />
          <span aria-hidden="true" style={{ position: 'absolute', insetBlock: 0, left: `${slider}%`, width: 2, transform: 'translateX(-1px)', background: 'var(--text-title)', pointerEvents: 'none' }} />
          <button type="button" role="slider" aria-label="Comparison divider" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={slider} aria-valuetext={`${slider}% checkpoint A shown`} onKeyDown={event => keySlider(event.key)}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event.clientX); }}
            onPointerMove={event => { if (event.buttons) setFromPointer(event.clientX); }}
            className="focus-visible:ring-2 focus-visible:ring-ring"
            style={{ position: 'absolute', top: '50%', left: `${slider}%`, transform: 'translate(-50%, -50%)', width: 28, height: 40, border: '1px solid var(--line-card)', borderRadius: 8, background: 'var(--bg-raised)', color: 'var(--text-title)', cursor: 'ew-resize', touchAction: 'none', zIndex: 2 }}>
            ⋮
          </button>
          <span style={{ position: 'absolute', left: 8, top: 8, padding: '2px 5px', borderRadius: 4, background: 'var(--bg-raised)', color: 'var(--text-secondary)', fontSize: 10 }}>A</span>
          <span style={{ position: 'absolute', right: 8, top: 8, padding: '2px 5px', borderRadius: 4, background: 'var(--bg-raised)', color: 'var(--text-secondary)', fontSize: 10 }}>B</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <CheckpointActions id={a} disabled={busy || !selectedA} onRestore={onRestore} onFork={onFork} />
          <CheckpointActions id={b} disabled={busy || !selectedB} onRestore={onRestore} onFork={onFork} />
        </div>
      </div> : null}

      {mode === 'diff' ? <div style={{ display: 'grid', gap: 6 }}>
        {diff ? <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
          {diff.changed === 0 ? 'No visual change' : `${diff.percent.toFixed(1)}% changed · ${diff.changed.toLocaleString()} px`}
        </div> : null}
        <ImageFrame source={diff?.src} label="Pixel difference" loading={diffLoading} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <CheckpointActions id={a} disabled={busy || !selectedA} onRestore={onRestore} onFork={onFork} />
          <CheckpointActions id={b} disabled={busy || !selectedB} onRestore={onRestore} onFork={onFork} />
        </div>
      </div> : null}
      {error ? <div role="status" style={{ color: 'var(--accent-red)', fontSize: 11, marginTop: 7 }}>{error}</div> : null}
      {loaded && !images[a] && !images[b] && mode !== 'diff' ? <div style={{ color: 'var(--text-hint)', fontSize: 11, marginTop: 6 }}>Could not load checkpoint screenshot.</div> : null}
    </div>
  </div>;
}

function CheckpointPicker({ side, value, options, onChange }: {
  side: 'A' | 'B'; value: string; options: CheckpointScreenshotChoice[]; onChange(value: string): void;
}) {
  const selected = options.find(option => option.id === value);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={`Checkpoint ${side}`} title={selected?.label} className="focus-visible:ring-2 focus-visible:ring-ring"
        style={{ display: 'flex', minWidth: 0, width: '100%', height: 30, alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-title)', font: 'inherit', fontSize: 11, textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected?.label ?? 'Choose screenshot'}</span>
        <ChevronDown size={12} style={{ flexShrink: 0 }} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" style={{ width: 360, maxWidth: '90vw', maxHeight: 260 }}>
      <DropdownMenuLabel>Screenshot checkpoints</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map(option => <DropdownMenuRadioItem key={option.id} value={option.id} title={option.label} className="text-xs">
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function CheckpointActions({ id, disabled, onRestore, onFork }: {
  id: string; disabled: boolean; onRestore(id: string): void; onFork(id: string): void;
}) {
  return <div style={{ display: 'flex', gap: 6 }}>
    <button type="button" disabled={disabled} onClick={() => onRestore(id)} className="focus-visible:ring-2 focus-visible:ring-ring" style={actionButton}>Restore</button>
    <button type="button" disabled={disabled} onClick={() => onFork(id)} className="focus-visible:ring-2 focus-visible:ring-ring" style={actionButton}>Fork</button>
  </div>;
}

function ImageFrame({ source, label, loading = false }: { source?: string; label: string; loading?: boolean }) {
  return <div style={{ width: '100%', height: 'min(58vh, 520px)', minHeight: 240, display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--bg-inset)', borderRadius: 6 }}>
    {source ? <img alt={label} src={source} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      : <span style={{ color: 'var(--text-hint)', fontSize: 11 }}>{loading ? 'Calculating diff…' : 'Loading screenshot…'}</span>}
  </div>;
}

const stackedImage = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'contain' as const, userSelect: 'none' as const, pointerEvents: 'none' as const };
const iconButton = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-secondary)', cursor: 'pointer' };
const actionButton = { border: '1px solid var(--line-card)', borderRadius: 5, padding: '5px 8px', background: 'var(--bg-inset)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 10.5, cursor: 'pointer' };
