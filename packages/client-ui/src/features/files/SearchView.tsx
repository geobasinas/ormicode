/** Search the session's folder by file name (fuzzy) or by content (ripgrep),
 *  content results grouped by file with highlighted line previews. */
import { useEffect, useMemo, useState } from 'react';
import { Search, X, FileText, Regex } from 'lucide-react';
import { useFileRequest } from './useFiles.ts';
import { type NameHit, type TextHit, baseName, dirName } from './types.ts';

const mono = { fontFamily: 'var(--font-mono)' } as const;
const mark = { color: 'var(--text-title)', background: 'color-mix(in srgb, var(--accent-amber) 26%, transparent)', borderRadius: 2 };

function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = []; let at = 0;
  for (const [a, b] of ranges) { if (a > at) parts.push(text.slice(at, a)); parts.push(<span key={a} style={mark}>{text.slice(a, b)}</span>); at = b; }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function toRanges(positions: number[]): [number, number][] {
  const sorted = [...positions].sort((a, b) => a - b); const out: [number, number][] = [];
  for (const p of sorted) { const last = out[out.length - 1]; if (last && last[1] === p) last[1] = p + 1; else out.push([p, p + 1]); }
  return out;
}

export function SearchView({ session, onOpen, onClose }: { session: string; onOpen: (path: string, line?: number) => void; onClose: () => void }) {
  const request = useFileRequest(session);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'name' | 'content'>('name');
  const [regex, setRegex] = useState(false);
  const [names, setNames] = useState<NameHit[]>([]);
  const [hits, setHits] = useState<TextHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const q = query.trim();
    if (!q) { setNames([]); setHits([]); setError(undefined); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await request<{ files?: NameHit[]; matches?: TextHit[]; truncated: boolean }>('file.search', { query: q, mode, ...(mode === 'content' && regex ? { regex: true } : {}) });
      if (!alive) return;
      if (r.error) { setError(r.error); return; }
      setError(undefined); setTruncated(r.body!.truncated);
      if (mode === 'name') setNames(r.body!.files ?? []); else setHits(r.body!.matches ?? []);
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [request, query, mode, regex]);
  const groups = useMemo(() => {
    const m = new Map<string, TextHit[]>();
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  }, [hits]);
  const tab = (id: 'name' | 'content', label: string) => (
    <button onClick={() => setMode(id)} style={{ font: 'inherit', fontSize: 11, height: 22, padding: '0 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
      background: mode === id ? 'var(--bg-raised)' : 'transparent', color: mode === id ? 'var(--text-title)' : 'var(--text-hint)' }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, flexShrink: 0, padding: '0 8px 0 12px', borderBottom: '1px solid var(--line-subtle)' }}>
        <Search size={13} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
          placeholder={mode === 'name' ? 'Go to file…' : 'Search in files…'}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-title)', font: 'inherit', fontSize: 12 }} />
        {mode === 'content' ? <button title="Regular expression" aria-pressed={regex} onClick={() => setRegex(r => !r)} className={regex ? undefined : 'hv'} style={{ border: 'none', width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: regex ? 'var(--bg-raised)' : 'transparent', color: regex ? 'var(--text-title)' : 'var(--text-hint)' }}><Regex size={12} /></button> : null}
        <span style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 7, padding: 2 }}>{tab('name', 'Files')}{tab('content', 'Text')}</span>
        <button title="Close search" onClick={onClose} className="hv" style={{ border: 'none', background: 'transparent', color: 'var(--text-hint)', display: 'inline-flex', padding: 4, borderRadius: 6, cursor: 'pointer' }}><X size={13} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
        {error ? <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--accent-red)' }}>{error}</div> : null}
        {query.trim() && !error && (mode === 'name' ? !names.length : !hits.length) ? <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text-hint)' }}>No matches</div> : null}
        {mode === 'name' ? names.map(n => {
          const d = dirName(n.path); const base = baseName(n.path); const off = n.path.length - base.length;
          return <div key={n.path} onClick={() => onOpen(n.path)} className="hv-row" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 12px', cursor: 'pointer', fontSize: 12 }}>
            <FileText size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-label)', whiteSpace: 'nowrap' }}><Highlight text={base} ranges={toRanges(n.positions.filter(p => p >= off).map(p => p - off))} /></span>
            <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</span>
          </div>;
        }) : groups.map(([path, list]) => (
          <div key={path} style={{ marginBottom: 4 }}>
            <div onClick={() => onOpen(path)} className="hv-row" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 12px', cursor: 'pointer', fontSize: 12 }}>
              <FileText size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-title)', fontWeight: 500, whiteSpace: 'nowrap' }}>{baseName(path)}</span>
              <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-hint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{dirName(path)}</span>
              <span style={{ ...mono, fontSize: 10, color: 'var(--text-hint)' }}>{list.length}</span>
            </div>
            {list.map(h => (
              <div key={`${h.line}:${h.ranges[0]?.[0] ?? 0}`} onClick={() => onOpen(path, h.line)} className="hv-row" style={{ display: 'flex', gap: 10, padding: '2px 12px 2px 32px', cursor: 'pointer', ...mono, fontSize: 11, lineHeight: '17px' }}>
                <span style={{ color: 'var(--text-hint)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>{h.line}</span>
                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}><Highlight text={h.text} ranges={h.ranges} /></span>
              </div>
            ))}
          </div>
        ))}
        {truncated ? <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-hint)' }}>More results not shown — refine the search.</div> : null}
      </div>
    </div>
  );
}
