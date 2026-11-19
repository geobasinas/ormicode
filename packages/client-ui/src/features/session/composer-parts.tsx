/** Pieces shared by the Home and session composers: image attachments
 * (pick or paste), picker chips and inline-editable chips. */
import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, FolderOpen, Pencil, RefreshCw, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '../../components/ui/dropdown-menu.tsx';
import { projectName } from '../../lib/format.ts';
import type { ListedModel } from './useModels.ts';

export interface Attached { data: string; mimeType: string; url: string; name: string; size: number }
const MAX_BYTES = 5 * 1024 * 1024;

export const chip = {
  font: 'inherit', fontSize: 11, color: 'var(--text-label)', background: 'var(--bg-chip)', border: 'none', borderRadius: 7,
  padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  minWidth: 0, overflow: 'hidden' as const,
};
export const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex', borderRadius: 6 };
const chev = <ChevronDown size={11} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />;

const read = (f: File) => new Promise<Attached>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok({ data: String(r.result).split(',')[1] ?? '', mimeType: f.type || 'application/octet-stream', url: String(r.result), name: f.name, size: f.size });
  r.onerror = () => fail(r.error); r.readAsDataURL(f);
});

/** Images for session.prompt/steer `images`; hidden <input> + paste handler. */
export function useImages() {
  const [images, setImages] = useState<Attached[]>([]);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: Iterable<File>) => {
    const ok = [...files].filter(f => f.type.startsWith('image/'));
    const big = ok.find(f => f.size > MAX_BYTES);
    setError(big ? `${big.name} is over 5 MB` : undefined);
    const next = await Promise.all(ok.filter(f => f.size <= MAX_BYTES).map(read));
    setImages(cur => [...cur, ...next]);
  };
  const remove = (i: number) => setImages(cur => cur.filter((_, j) => j !== i));
  const clear = () => setImages([]);
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); void add(files); }
  };
  const picker = <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { void add(e.target.files ?? []); e.target.value = ''; }} />;
  const wire = images.map(({ data, mimeType, name, size }) => ({ data, mimeType, name, size }));
  return { images, wire, error, add, remove, clear, onPaste, picker, pick: () => input.current?.click() };
}

export function useFiles() {
  const [files, setFiles] = useState<Attached[]>([]);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const add = async (list: Iterable<File>) => {
    const accepted = [...list].filter(file => !file.type.startsWith('image/'));
    const next = await Promise.all(accepted.map(read));
    const total = [...files, ...next].reduce((sum, file) => sum + file.size, 0);
    const tooBig = next.find(file => file.size > 10 * 1024 * 1024);
    setError(tooBig ? `${tooBig.name} is over 10 MB` : total > 25 * 1024 * 1024 ? 'Attachments are over 25 MB total' : undefined);
    if (!tooBig && total <= 25 * 1024 * 1024) setFiles(cur => [...cur, ...next]);
  };
  const remove = (index: number) => setFiles(cur => cur.filter((_, i) => i !== index));
  const clear = () => setFiles([]);
  const wire = files.map(({ name, mimeType, data }) => ({ name, mimeType, data }));
  const picker = <input ref={input} type="file" multiple hidden onChange={event => { void add(event.target.files ?? []); event.target.value = ''; }} />;
  return { files, wire, error, add, remove, clear, picker, pick: () => input.current?.click() };
}

export function ImageStrip({ images, onRemove }: { images: Attached[]; onRemove: (i: number) => void }) {
  if (!images.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 6px' }}>
      {images.map((im, i) => (
        <span key={i} title={im.name} style={{ position: 'relative', width: 44, height: 44, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--line-card)' }}>
          <img src={im.url} alt={im.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <span style={{ position: 'absolute', left: 2, bottom: 2, borderRadius: 3, padding: '1px 3px', background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 8, lineHeight: 1.2, pointerEvents: 'none' }}>Image #{i + 1}</span>
          <button aria-label={`remove ${im.name}`} onClick={() => onRemove(i)} style={{
            position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer',
            background: 'rgba(0,0,0,0.65)', color: '#ddd', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={10} /></button>
        </span>
      ))}
    </div>
  );
}

/** Chip that opens a radio menu. */
export function MenuChip({ value, choices, onChange, label, icon, title }: {
  value: string; choices: { value: string; name?: string }[]; onChange: (v: string) => void; label?: string; icon?: ReactNode; title?: string;
}) {
  const current = choices.find(c => c.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hv-sub" style={chip} title={title}>{icon}<span className="ormi-chip-text">{current?.name ?? value}</span>{chev}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {choices.map(c => <DropdownMenuRadioItem key={c.value} value={c.value}>{c.name ?? c.value}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelChip({ value, models, loading, onChange, refresh, icon, title }: {
  value: string; models: ListedModel[]; loading: boolean; onChange: (v: string) => void; refresh: () => Promise<unknown>; icon?: ReactNode; title?: string;
}) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  models = models.filter(model => model.id !== 'default');
  if (custom) return <TextChip autoEdit onDone={() => setCustom(false)} title={title} icon={icon} value={value} onCommit={onChange} />;
  const current = models.find(model => model.id === value);
  const matching = models.filter(model => `${model.label}\n${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = matching.slice(0, 200);
  return (
    <DropdownMenu onOpenChange={open => { if (!open) setQuery(''); }}>
      <DropdownMenuTrigger asChild>
        <button className="hv-sub" style={chip} title={title}>
          {icon}<span className="ormi-chip-text">{value === 'default' ? 'default' : current?.label ?? value}</span>{chev}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" style={{ width: 300, maxWidth: 'calc(100vw - 16px)', maxHeight: 420 }}>
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        {models.length > 10 ? (
          <div style={{ padding: '2px 8px 8px' }}>
            <input
              autoFocus
              aria-label="Search models"
              placeholder="Search models…"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.stopPropagation()}
              onClick={event => event.stopPropagation()}
              style={{
                width: '100%', height: 28, boxSizing: 'border-box', padding: '0 8px',
                font: 'inherit', fontSize: 11, color: 'var(--text-title)', background: 'var(--bg-inset)',
                border: '1px solid var(--line-card)', borderRadius: 6, outline: 'none',
              }}
            />
          </div>
        ) : null}
        <DropdownMenuItem onSelect={() => onChange('default')} className="text-xs">
          <span style={{ width: 16, display: 'inline-flex' }}>{value === 'default' ? <Check size={13} /> : null}</span>
          <span>Default</span>
        </DropdownMenuItem>
        {loading ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>Loading models…</div>
          : !models.length ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>This agent doesn&apos;t list models</div> : null}
        {!loading && models.length ? (
          <>
            {visible.map(model => (
              <DropdownMenuItem
                key={model.id}
                disabled={!model.available}
                title={!model.available ? model.reason : undefined}
                onSelect={() => onChange(model.id)}
                className="text-xs"
              >
                <span style={{ width: 16, display: 'inline-flex' }}>{value === model.id ? <Check size={13} /> : null}</span>
                <span className="min-w-0 flex-1 truncate">{model.label}</span>
                {model.label !== model.id ? <span style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{model.id}</span> : null}
              </DropdownMenuItem>
            ))}
            {matching.length > visible.length ? <div style={{ padding: '5px 10px', color: 'var(--text-hint)', fontSize: 10 }}>Showing 200 of {matching.length} — refine search</div> : null}
            {!matching.length ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>No matching models</div> : null}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCustom(true)} className="text-xs"><span style={{ width: 16, display: 'inline-flex' }} />Custom model id…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={event => { event.preventDefault(); void refresh(); }} className="text-xs">
          <RefreshCw size={12} />Refresh list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EffortChip({ value, model, models, onChange, icon, title, width = 60 }: {
  value: string; model: string; models: ListedModel[]; onChange: (v: string) => void; icon?: ReactNode; title?: string; width?: number;
}) {
  const selected = models.find(candidate => candidate.id === model);
  let choices = selected?.efforts;
  if (!selected) {
    const sets = models.map(candidate => [...candidate.efforts].sort().join('\0'));
    if (sets.length && new Set(sets).size === 1) choices = models[0]!.efforts;
  }
  if (selected && !choices?.length) {
    return <button disabled style={{ ...chip, opacity: 0.45, cursor: 'not-allowed' }} title="This model has no effort levels">{icon}<span className="ormi-chip-text">{value}</span>{chev}</button>;
  }
  if (!choices?.length) return <TextChip title={title} icon={icon} width={width} value={value} onCommit={onChange} />;
  const invalid = value !== 'default' && !choices.includes(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hv-sub" style={chip} title={invalid ? 'not offered by this model' : title}>
          {icon}<span className="ormi-chip-text">{value}</span>
          {invalid ? <span aria-label="not offered by this model" style={{ color: 'var(--accent-amber)', fontSize: 10, lineHeight: 1 }}>●</span> : null}
          {chev}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        {['default', ...choices].map(choice => (
          <DropdownMenuItem key={choice} onSelect={() => onChange(choice)} className="text-xs">
            <span style={{ width: 16, display: 'inline-flex' }}>{value === choice ? <Check size={13} /> : null}</span>
            <span>{choice === 'default' ? 'Default' : choice}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Project chip: known folders, native browse and free path entry. */
export function ProjectChip({ value, projects, onChange, onBrowse, icon, title }: {
  value: string; projects: string[]; onChange: (path: string) => void; onBrowse: () => Promise<string | null>; icon?: ReactNode; title?: string;
}) {
  const [custom, setCustom] = useState(false);
  if (custom) return <TextChip autoEdit onDone={() => setCustom(false)} title={title} icon={icon} value={value} onCommit={onChange} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hv-sub" style={chip} title={title}>
          {icon}<span className="ormi-chip-text">{projectName(value)}</span>{chev}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" style={{ maxWidth: 'calc(100vw - 16px)' }}>
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        {['scratch', ...new Map(projects.map(p => [p.replace(/\\/g, '/').toLowerCase(), p])).values()].map(path => (
          <DropdownMenuItem key={path} onSelect={() => onChange(path)} title={path === 'scratch' ? 'no project folder' : path} className="text-xs">
            <span style={{ width: 16, display: 'inline-flex' }}>{value === path ? <Check size={13} /> : null}</span>
            <span className="min-w-0 flex-1 truncate">{projectName(path)}</span>
            {path !== 'scratch' ? <span style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10 }} className="truncate">{path}</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void onBrowse()} className="text-xs"><FolderOpen size={12} />Browse for folder…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCustom(true)} className="text-xs"><Pencil size={12} />Enter path…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Chip showing a value; click to type a new one (Enter commits, Esc cancels). */
export function TextChip({ value, onCommit, title, placeholder, icon, width = 96, autoEdit = false, onDone }: {
  value: string; onCommit: (v: string) => void; title?: string; placeholder?: string; icon?: ReactNode; width?: number; autoEdit?: boolean; onDone?: () => void;
}) {
  const finished = useRef(false);
  const [draft, setDraft] = useState<string | undefined>(() => autoEdit ? (value === 'default' ? '' : value) : undefined);
  if (draft === undefined) {
    return <button className="hv-sub" style={chip} title={title} onClick={() => { finished.current = false; setDraft(value === 'default' ? '' : value); }}>{icon}<span className="ormi-chip-text">{value}</span>{chev}</button>;
  }
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    const v = draft.trim() || 'default';
    setDraft(undefined);
    if (v !== value) onCommit(v);
    onDone?.();
  };
  return (
    <span style={{ ...chip, cursor: 'text', boxShadow: '0 0 0 1px var(--line-card)' }} title={title}>
      {icon}
      <input autoFocus value={draft} placeholder={placeholder ?? 'default'} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') {
            if (finished.current) return;
            finished.current = true; setDraft(undefined); onDone?.();
          }
        }}
        style={{ width, font: 'inherit', fontSize: 'inherit', color: 'var(--text-title)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
    </span>
  );
}
