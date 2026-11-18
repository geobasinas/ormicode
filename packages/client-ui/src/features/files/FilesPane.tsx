/** Files side panel (Desktop — Files mockup): path bar with back/forward/up,
 *  a virtualized tree with Name / Date modified / Type / Size and git colours,
 *  a status bar, search, and the file viewer/editor. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, ArrowRight, ArrowUp, RotateCw, Search, Ellipsis, ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Link2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { usePlatform } from '../../lib/platform.ts';
import { OPEN_FILE, takeOpenFile } from '../../lib/openFile.ts';
import { useListings, useFileRequest } from './useFiles.ts';
import { FileView } from './FileView.tsx';
import { SearchView } from './SearchView.tsx';
import { type Entry, GIT_COLOR, GIT_LETTER, baseName, dirName, formatDate, formatSize, sortEntries, typeLabel } from './types.ts';

const ROW = 26;
const mono = { fontFamily: 'var(--font-mono)' } as const;
const cols = { date: 128, type: 84, size: 64 };
type Desk = { openPath?: (p: string) => Promise<string>; showItemInFolder?: (p: string) => void } | undefined;

function NavBtn({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return <button title={title} disabled={disabled} onClick={onClick} className={disabled ? undefined : 'hv'} style={{
    border: 'none', width: 24, height: 24, borderRadius: 6, background: 'transparent', color: 'var(--text-hint)', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
  }}>{children}</button>;
}

export function FilesPane({ session, onOpenSession }: { session: string; onOpenSession?: (id: string) => void }) {
  const platform = usePlatform();
  const desk = platform.desktop as Desk;
  const request = useFileRequest(session);
  const { dirs, error, load, reloadAll } = useListings(session);
  const [cwd, setCwd] = useState('');
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<'tree' | 'search' | { path: string; line?: number }>('tree');
  const [hideIgnored, setHideIgnored] = useState(false);
  const [isGit, setIsGit] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { void request('git.status').then(r => setIsGit(!r.error)); }, [request]);
  useEffect(() => { void load(cwd); }, [load, cwd]);
  const root = dirs['']?.root ?? dirs[cwd]?.root;

  const go = (path: string) => { if (path === cwd) return; setBack(b => [...b, cwd]); setFwd([]); setCwd(path); setOpen(new Set()); setSelected(undefined); };
  const toggle = (path: string) => setOpen(o => {
    const n = new Set(o);
    if (n.has(path)) n.delete(path); else { n.add(path); if (!dirs[path]) void load(path); }
    return n;
  });

  const rows = useMemo(() => {
    const out: { e: Entry; depth: number }[] = [];
    const walk = (path: string, depth: number) => {
      const l = dirs[path]; if (!l) return;
      for (const e of sortEntries(l.entries)) {
        if (hideIgnored && e.git === 'ignored') continue;
        out.push({ e, depth });
        if (e.kind === 'dir' && open.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk(cwd, 0);
    return out;
  }, [dirs, cwd, open, hideIgnored]);

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 12, useFlushSync: false });
  const abs = (p: string) => (root ? (p ? `${root}/${p}` : root) : undefined);
  const openFile = (path: string, line?: number) => { setSelected(path); setView({ path, line }); };
  const relative = (p: string) => {
    const wire = p.replace(/\\/g, '/');
    if (!/^([a-z]:)?\//i.test(wire)) return wire.replace(/^\.\//, '');
    return root && wire.startsWith(`${root.replace(/\\/g, '/')}/`) ? wire.slice(root.length + 1) : undefined;
  };
  useEffect(() => {
    const take = () => { const p = root !== undefined ? takeOpenFile(session) : undefined; const rel = p ? relative(p) : undefined; if (rel) openFile(rel); };
    take();
    window.addEventListener(OPEN_FILE, take);
    return () => window.removeEventListener(OPEN_FILE, take);
  });
  const onKey = (ev: React.KeyboardEvent) => {
    const i = rows.findIndex(r => r.e.path === selected);
    const pick = (n: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, n))]; if (r) { setSelected(r.e.path); virt.scrollToIndex(rows.indexOf(r)); } };
    const cur = rows[i]?.e;
    if (ev.key === 'ArrowDown') pick(i + 1);
    else if (ev.key === 'ArrowUp') pick(i < 0 ? 0 : i - 1);
    else if (ev.key === 'ArrowRight' && cur?.kind === 'dir' && !open.has(cur.path)) toggle(cur.path);
    else if (ev.key === 'ArrowLeft' && cur) { if (cur.kind === 'dir' && open.has(cur.path)) toggle(cur.path); else { const parent = dirName(cur.path); if (parent !== cwd && parent) setSelected(parent); } }
    else if (ev.key === 'Enter' && cur) { if (cur.kind === 'dir') go(cur.path); else openFile(cur.path); }
    else if (ev.key === 'Backspace' && cwd) go(dirName(cwd));
    else return;
    ev.preventDefault();
  };
  const gitOf = (path: string) => dirs[dirName(path)]?.entries.find(e => e.path === path)?.git;

  if (view === 'search') return <SearchView session={session} onClose={() => setView('tree')} onOpen={openFile} />;
  if (typeof view === 'object') return <FileView session={session} path={view.path} line={view.line} git={gitOf(view.path)} isGit={isGit}
    onBack={() => setView('tree')} onOpenSession={onOpenSession} onGoFolder={p => { setView('tree'); go(p); }}
    onOpenExternal={desk?.openPath && abs(view.path) ? () => void desk.openPath!(abs(view.path)!) : undefined} />;

  const crumbs = cwd ? cwd.split('/') : [];
  const listing = dirs[cwd];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 38, flexShrink: 0, padding: '0 8px 0 12px' }}>
        <span style={{ ...mono, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', marginLeft: -3 }}>
          <button onClick={() => go('')} className="hv" style={{ ...crumb, color: cwd ? 'var(--text-hint)' : 'var(--text-title)', fontWeight: cwd ? 400 : 600 }}>{root ? baseName(root) : '…'}</button>
          {crumbs.map((c, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ color: 'var(--text-hint)' }}>/</span>
            <button onClick={() => go(crumbs.slice(0, i + 1).join('/'))} className="hv" style={{ ...crumb, color: i === crumbs.length - 1 ? 'var(--text-title)' : 'var(--text-hint)', fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>{c}</button>
          </span>)}
        </span>
        <NavBtn title="Back" disabled={!back.length} onClick={() => { const p = back[back.length - 1]!; setBack(b => b.slice(0, -1)); setFwd(f => [cwd, ...f]); setCwd(p); }}><ArrowLeft size={13} /></NavBtn>
        <NavBtn title="Forward" disabled={!fwd.length} onClick={() => { const [p, ...rest] = fwd; setFwd(rest); setBack(b => [...b, cwd]); setCwd(p!); }}><ArrowRight size={13} /></NavBtn>
        <NavBtn title="Up" disabled={!cwd} onClick={() => go(dirName(cwd))}><ArrowUp size={13} /></NavBtn>
        <NavBtn title="Refresh" onClick={reloadAll}><RotateCw size={12} /></NavBtn>
        <NavBtn title="Search files" onClick={() => setView('search')}><Search size={13} /></NavBtn>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button title="More" className="hv" style={{ border: 'none', width: 24, height: 24, borderRadius: 6, background: 'transparent', color: 'var(--text-hint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Ellipsis size={14} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {desk?.openPath && abs(cwd) ? <DropdownMenuItem onClick={() => void desk.openPath!(abs(cwd)!)}>Open folder in file manager</DropdownMenuItem> : null}
            {desk?.showItemInFolder && selected && abs(selected) ? <DropdownMenuItem onClick={() => desk.showItemInFolder!(abs(selected)!)}>Show selected in file manager</DropdownMenuItem> : null}
            <DropdownMenuItem onClick={() => setHideIgnored(h => !h)}>{hideIgnored ? 'Show ignored files' : 'Hide ignored files'}</DropdownMenuItem>
            {selected ? <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(selected)}>Copy relative path</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', height: 24, flexShrink: 0, padding: '0 12px 0 49px', fontSize: 10.5, color: 'var(--text-hint)', borderBottom: '1px solid var(--line-subtle)' }}>
        <span style={{ flex: 1 }}>Name</span>
        <span className="ormi-pane-narrow-hide" style={{ width: cols.date }}>Date modified</span>
        <span className="ormi-pane-narrow-hide" style={{ width: cols.type }}>Type</span>
        <span style={{ width: cols.size, textAlign: 'right' }}>Size</span>
      </div>
      <div ref={scroller} tabIndex={0} onKeyDown={onKey} className="ormi-tree" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 0' }}>
        {error && !listing ? <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--accent-red)' }}>{error}</div> : null}
        {!listing && !error ? <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text-hint)' }}>Loading…</div> : null}
        {listing && !rows.length ? <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text-hint)' }}>Empty folder</div> : null}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map(item => {
            const { e, depth } = rows[item.index]!;
            const isDir = e.kind === 'dir'; const expanded = open.has(e.path); const on = selected === e.path;
            const color = e.git && GIT_COLOR[e.git] ? GIT_COLOR[e.git] : 'var(--text-label)';
            const Icon = isDir ? (expanded ? FolderOpen : Folder) : e.kind === 'symlink' ? Link2 : FileText;
            return (
              <div key={e.path} onClick={() => { setSelected(e.path); if (isDir) toggle(e.path); else openFile(e.path); }}
                onDoubleClick={() => isDir && go(e.path)} className={on ? undefined : 'hv-row'} style={{
                  position: 'absolute', top: 0, left: 6, right: 6, height: ROW, transform: `translateY(${item.start}px)`,
                  display: 'flex', alignItems: 'center', gap: 6, padding: `0 6px 0 ${6 + depth * 14}px`, borderRadius: 6, cursor: 'pointer',
                  background: on ? 'var(--bg-raised)' : 'transparent', fontSize: 12, opacity: e.git === 'ignored' ? 0.5 : 1,
                }}>
                <span style={{ width: 12, display: 'inline-flex', color: 'var(--text-hint)', flexShrink: 0 }}>{isDir ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
                <Icon size={13} style={{ color: isDir ? 'var(--text-secondary)' : 'var(--text-hint)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: e.git === 'deleted' ? 'line-through' : undefined }}>{e.name}</span>
                  {e.git && GIT_LETTER[e.git] ? <span style={{ ...mono, fontSize: 9.5, color, flexShrink: 0 }}>{GIT_LETTER[e.git]}</span> : null}
                </span>
                <span className="ormi-pane-narrow-hide" style={{ width: cols.date, fontSize: 10.5, color: 'var(--text-hint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{e.mtime ? formatDate(e.mtime) : ''}</span>
                <span className="ormi-pane-narrow-hide" style={{ width: cols.type, fontSize: 10.5, color: 'var(--text-hint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{typeLabel(e)}</span>
                <span style={{ width: cols.size, fontSize: 10.5, color: 'var(--text-hint)', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>{isDir ? '' : formatSize(e.size)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', height: 26, flexShrink: 0, padding: '0 12px', fontSize: 10.5, color: 'var(--text-hint)', borderTop: '1px solid var(--line-subtle)' }}>
        <span>{listing ? (n => `${n} ${n === 1 ? 'item' : 'items'}`)(listing.entries.filter(e => !hideIgnored || e.git !== 'ignored').length) : ''}{selected ? ' · 1 selected' : ''}</span>
        <span style={{ flex: 1 }} />
        <span>{listing?.free != null ? `${formatSize(listing.free)} free` : ''}</span>
      </div>
    </div>
  );
}

const crumb = { font: 'inherit', fontSize: 11, border: 'none', background: 'transparent', padding: '2px 3px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
