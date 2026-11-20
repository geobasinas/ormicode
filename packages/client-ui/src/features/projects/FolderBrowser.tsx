import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowUp, ChevronRight, Folder, LoaderCircle, X } from 'lucide-react';
import { Button } from '../../components/Button.tsx';
import { usePlatform } from '../../lib/platform.ts';

interface Machine { id: string; name: string; }
interface Entry { name: string; path: string; git: boolean; hidden: boolean; }
interface BrowseResult { machine: string; path: string; parent: string | null; home: string; entries: Entry[]; truncated: boolean; }

export function FolderBrowser({ machine, busy, error: addError, onBack, onCancel, onAdd }: {
  machine: Machine; busy: boolean; error: string; onBack(): void; onCancel(): void; onAdd(path: string): void;
}) {
  const { transport } = usePlatform();
  const [current, setCurrent] = useState<BrowseResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState('');
  const currentPath = useRef<{ machine: string; path: string } | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const browse = useCallback(async (path?: string) => {
    setLoading(true); setError(''); setSelected('');
    try {
      const result = await transport.request('fs.browse', { machine: machine.id, ...(path ? { path } : {}), hidden });
      if (result.type === 'err') { setError(messageFor(result.code)); return; }
      setCurrent(result.body as BrowseResult);
      currentPath.current = { machine: machine.id, path: (result.body as BrowseResult).path };
    } catch {
      setError("Can't open this folder: the machine could not be reached.");
    } finally { setLoading(false); }
  }, [hidden, machine.id, transport]);
  useEffect(() => { void browse(currentPath.current?.machine === machine.id ? currentPath.current.path : undefined); }, [browse, machine.id]);
  const entries = useMemo(() => (current?.entries ?? []).filter(entry => entry.name.toLowerCase().includes(filter.trim().toLowerCase())), [current, filter]);
  const selectedEntry = entries.find(entry => entry.path === selected);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!entries.length) return;
      const index = entries.findIndex(entry => entry.path === selected);
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length - 1)
        : Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setSelected(entries[next]!.path);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-folder-index="${next}"]`)?.focus());
    }
    if (event.key === 'Enter' && selectedEntry) { event.preventDefault(); void browse(selectedEntry.path); }
  };
  const chosen = selectedEntry?.path ?? current?.path ?? '';
  return <>
    <div style={header}>
      <button aria-label="Back to machines" title="Back to machines" onClick={onBack} style={iconButton}><ArrowLeft size={15} /></button>
      <strong style={{ flex: 1, minWidth: 0, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{machine.name}</strong>
      <button aria-label="Close" onClick={onCancel} style={iconButton}><X size={15} /></button>
    </div>
    <div style={crumbBar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflow: 'auto', flex: 1 }}>
        {current ? breadcrumbs(current.path).map((crumb, index) => <span key={crumb.path} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
          {index ? <ChevronRight size={11} style={{ color: 'var(--text-hint)' }} /> : null}
          <button className="hv-sub" onClick={() => void browse(crumb.path)} style={crumbButton} title={crumb.path}>{crumb.label}</button>
        </span>) : <span style={smallText}>Loading folder…</span>}
      </div>
      <button type="button" aria-label="Go up one folder" title="Up" disabled={!current?.parent || loading} onClick={() => current?.parent && void browse(current.parent)}
        style={{ ...iconButton, opacity: current?.parent ? 1 : 0.4 }}><ArrowUp size={14} /></button>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
      <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter folders" aria-label="Filter folders" style={field} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10.5, color: 'var(--text-secondary)' }}>
        <input type="checkbox" className="ormi-check" checked={hidden} onChange={event => setHidden(event.target.checked)} />Show hidden
      </label>
    </div>
    <div ref={list} role="listbox" aria-label="Folders" tabIndex={0} onKeyDown={keyDown} style={folderList}>
      {loading ? <div style={status}><LoaderCircle size={13} className="animate-spin" />Loading folders…</div>
        : error || addError ? <div role="alert" style={errorStyle}>{error || addError}</div>
          : entries.length ? entries.map((entry, index) => <button key={entry.path} type="button" role="option" aria-selected={selected === entry.path}
            data-folder-index={index} onClick={() => setSelected(entry.path)} onDoubleClick={() => void browse(entry.path)}
            style={{ ...folderRow, background: selected === entry.path ? 'var(--bg-selected)' : 'transparent' }}>
            <Folder size={14} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            {entry.git ? <span style={gitPill}>git</span> : null}
          </button>) : <div style={status}>{filter ? 'No folders match.' : 'No folders here.'}</div>}
    </div>
    {current?.truncated ? <div style={truncated}>Showing first 2000 folders</div> : null}
    <div style={footer}>
      <span title={chosen} style={chosenPath}><bdi>{chosen}</bdi></span>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button variant="primary" disabled={busy || !chosen} onClick={() => onAdd(chosen)}>{busy ? 'Adding…' : 'Add project'}</Button>
    </div>
  </>;
}

function messageFor(code: string): string {
  if (code === 'fs.invalid_path') return "Can't open this folder: the path is not valid.";
  if (code === 'fs.not_found') return "Can't open this folder: it can't be found.";
  if (code === 'fs.not_directory') return "Can't open this folder: that path isn't a folder.";
  if (code === 'fs.denied') return "Can't open this folder: permission denied.";
  if (code === 'machine.unreachable') return "Can't open this folder: the machine is offline.";
  return "Can't open this folder.";
}

function breadcrumbs(path: string): { label: string; path: string }[] {
  const separator = path.includes('\\') ? '\\' : '/';
  const pieces = path.split(/[\\/]+/).filter(Boolean);
  const drive = /^[A-Za-z]:$/.test(pieces[0] ?? '') ? pieces.shift() : undefined;
  const unc = path.startsWith('\\\\') ? pieces.splice(0, 2) : undefined;
  const root = unc ? `\\\\${unc.join('\\')}\\` : drive ? `${drive}\\` : path.startsWith('/') ? '/' : '';
  const crumbs = root ? [{ label: root, path: root }] : [];
  let current = root;
  for (const piece of pieces) {
    current = current ? `${current.replace(/[\\/]+$/, '')}${separator}${piece}` : piece;
    crumbs.push({ label: piece, path: current });
  }
  return crumbs;
}

const header: CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 8 };
const iconButton: CSSProperties = { display: 'grid', placeItems: 'center', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer' };
const crumbBar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, minHeight: 30, padding: '0 4px', borderRadius: 7, background: 'var(--bg-inset)' };
const crumbButton: CSSProperties = { padding: '4px 5px', border: 0, borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', fontSize: 10.5, cursor: 'pointer' };
const smallText: CSSProperties = { color: 'var(--text-hint)', fontSize: 11 };
const field: CSSProperties = { minWidth: 0, flex: 1, height: 30, boxSizing: 'border-box', padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 11 };
const folderList: CSSProperties = { minHeight: 110, maxHeight: 300, overflow: 'auto', border: '1px solid var(--line-card)', borderRadius: 7, padding: 4, outline: 'none' };
const folderRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 30, padding: '0 7px', border: 0, borderRadius: 5, color: 'var(--text-label)', textAlign: 'left', font: 'inherit', fontSize: 11.5, cursor: 'pointer' };
const gitPill: CSSProperties = { padding: '1px 4px', border: '1px solid var(--line-card)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: 9 };
const status: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: 10, color: 'var(--text-secondary)', fontSize: 11 };
const errorStyle: CSSProperties = { padding: 10, color: 'var(--accent-red)', fontSize: 11 };
const truncated: CSSProperties = { marginTop: 5, color: 'var(--text-hint)', fontSize: 10 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 };
const chosenPath: CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 9.5 };
