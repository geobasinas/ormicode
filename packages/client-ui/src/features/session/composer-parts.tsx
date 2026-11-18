/** Pieces shared by the Home and session composers: image attachments
 * (pick or paste), picker chips and inline-editable chips. */
import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, DropdownMenuLabel } from '../../components/ui/dropdown-menu.tsx';

export interface Attached { data: string; mimeType: string; url: string; name: string }
const MAX_BYTES = 5 * 1024 * 1024;

export const chip = {
  font: 'inherit', fontSize: 11, color: '#b7b7b7', background: 'var(--bg-chip)', border: 'none', borderRadius: 7,
  padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  minWidth: 0, overflow: 'hidden' as const,
};
export const iconBtn = { background: 'none', border: 'none', color: 'var(--text-hint)', font: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex', borderRadius: 6 };
const chev = <ChevronDown size={11} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />;

const read = (f: File) => new Promise<Attached>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok({ data: String(r.result).split(',')[1] ?? '', mimeType: f.type, url: String(r.result), name: f.name });
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
  const wire = images.map(({ data, mimeType }) => ({ data, mimeType }));
  return { images, wire, error, add, remove, clear, onPaste, picker, pick: () => input.current?.click() };
}

export function ImageStrip({ images, onRemove }: { images: Attached[]; onRemove: (i: number) => void }) {
  if (!images.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 6px' }}>
      {images.map((im, i) => (
        <span key={i} title={im.name} style={{ position: 'relative', width: 44, height: 44, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--line-card)' }}>
          <img src={im.url} alt={im.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

/** Chip showing a value; click to type a new one (Enter commits, Esc cancels). */
export function TextChip({ value, onCommit, title, placeholder, icon, width = 96 }: {
  value: string; onCommit: (v: string) => void; title?: string; placeholder?: string; icon?: ReactNode; width?: number;
}) {
  const [draft, setDraft] = useState<string>();
  if (draft === undefined) {
    return <button className="hv-sub" style={chip} title={title} onClick={() => setDraft(value === 'default' ? '' : value)}>{icon}<span className="ormi-chip-text">{value}</span>{chev}</button>;
  }
  const commit = () => { const v = draft.trim() || 'default'; setDraft(undefined); if (v !== value) onCommit(v); };
  return (
    <span style={{ ...chip, cursor: 'text', boxShadow: '0 0 0 1px var(--line-card)' }} title={title}>
      {icon}
      <input autoFocus value={draft} placeholder={placeholder ?? 'default'} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setDraft(undefined); }}
        style={{ width, font: 'inherit', fontSize: 'inherit', color: 'var(--text-title)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }} />
    </span>
  );
}
