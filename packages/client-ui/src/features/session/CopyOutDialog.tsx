import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, Loader2, X } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { loadPrefs, rememberProject } from '../../lib/prefs.ts';
import type { Entry } from '../files/types.ts';
import { feedback } from '../../lib/feedback.ts';
import { useModalFocus } from '../../lib/useModalFocus.ts';

export function CopyOutDialog({ session, onClose, initialPaths = [] }: { session: string; onClose(): void; initialPaths?: string[] }) {
  const { transport, desktop } = usePlatform();
  const projects = loadPrefs().projects ?? [];
  const [project, setProject] = useState(projects[0] ?? '');
  const [dest, setDest] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [listing, setListing] = useState(true);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string[]>(initialPaths);
  const [overwrite, setOverwrite] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(true, dialog, onClose);

  useEffect(() => {
    let alive = true;
    void transport.request('file.list', { session, path: '' }).then(result => {
      if (!alive) return;
      if (result.type === 'res') setEntries((result.body as { entries?: Entry[] }).entries ?? []);
      else setListError(String(result.message ?? result.code));
    }).catch(cause => { if (alive) setListError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (alive) setListing(false); });
    return () => { alive = false; };
  }, [session, transport]);

  const toggle = (path: string) => setSelected(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]);
  const chooseFolder = async () => {
    const path = await desktop?.pickFolder?.();
    if (path) { setProject(path); rememberProject(path); }
  };
  const copy = async () => {
    if (!selected.length || !project) return;
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await transport.request('session.copyOut', { session, paths: selected, project, ...(dest.trim() ? { dest: dest.trim() } : {}), ...(overwrite ? { overwrite: true } : {}) });
      if (result.type === 'res') {
        rememberProject(project);
        const copied = (result.body as { copied?: unknown[] }).copied ?? [];
        feedback.success(`Copied ${copied.length} file${copied.length === 1 ? '' : 's'} to project`, desktop?.openPath ? {
          label: 'Open', onClick: () => { void desktop.openPath(project); },
        } : undefined);
        onClose();
      }
      else {
        const message = String(result.message);
        setError(message);
        feedback.error(message);
        if (result.code === 'copy_out.conflict') setConflict(true);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message); feedback.error(message);
    }
    finally { setBusy(false); }
  };

  return <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{
    position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', padding: 20, background: 'var(--modal-scrim)',
  }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="Copy to project" onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); void copy(); }
    }} style={{
      width: 'min(440px, 100%)', maxHeight: '85vh', overflow: 'auto', padding: 24, borderRadius: 12,
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', color: 'var(--text-active)', boxShadow: '0 16px 48px var(--shadow-color)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ flex: 1, fontSize: 15 }}>Copy to project</strong>
        <button aria-label="Close" onClick={onClose} style={{ border: 0, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer' }}><X size={14} /></button>
      </div>
      <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 11, color: 'var(--text-secondary)' }}>Project
        <div style={{ display: 'flex', gap: 8 }}>
          <select aria-label="Destination project" value={project} onChange={event => setProject(event.target.value)} style={field}>
            <option value="">Choose a recent project…</option>
            {projects.map(path => <option key={path} value={path}>{path}</option>)}
          </select>
          <button onClick={() => void chooseFolder()} style={button}>Choose folder…</button>
        </div>
      </label>
      <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 11, color: 'var(--text-secondary)' }}>Destination folder
        <input aria-label="Destination folder" value={dest} onChange={event => setDest(event.target.value)} placeholder="Project root" style={field} />
      </label>
      <div style={{ marginBottom: 5, fontSize: 11, color: 'var(--text-secondary)' }}>Files and folders</div>
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line-card)', borderRadius: 7, padding: 4 }}>
        {listError ? <div role="alert" style={{ padding: 8, fontSize: 11, color: 'var(--accent-red)' }}>{listError}</div>
          : listing ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 8, fontSize: 11, color: 'var(--text-hint)' }}><Loader2 size={12} className="animate-spin" />Loading files…</div>
          : entries.length ? entries.map(entry => <label key={entry.path} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 28, padding: '0 6px', fontSize: 11.5, color: 'var(--text-label)' }}>
          <input type="checkbox" checked={selected.includes(entry.path)} onChange={() => toggle(entry.path)} />
          {entry.kind === 'dir' ? <Folder size={13} /> : <FileText size={13} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
        </label>) : <div style={{ padding: 8, fontSize: 11, color: 'var(--text-hint)' }}>No files yet — add a file in Scratch first.</div>}
      </div>
      {conflict ? <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, color: 'var(--accent-amber)', fontSize: 11 }}>
        <input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />Overwrite existing files
      </label> : null}
      {error ? <div role="alert" style={{ marginTop: 8, color: conflict ? 'var(--accent-amber)' : 'var(--accent-red)', fontSize: 11 }}>{error}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
        <button onClick={onClose} style={button}>Cancel</button>
        <button disabled={busy || !selected.length || !project} title={!project ? 'Choose a destination project' : !selected.length ? 'Select files or folders to copy' : undefined} onClick={() => void copy()} style={{ ...button, background: 'var(--text-title)', color: 'var(--bg-main)' }}>{busy ? 'Copying…' : 'Copy files'}</button>
      </div>
    </section>
  </div>;
}

const field = { minWidth: 0, width: '100%', height: 30, boxSizing: 'border-box' as const, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 11 };
const button = { minHeight: 28, padding: '0 9px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-raised)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 11, cursor: 'pointer' };
