/** Open file: viewer (syntax highlighted, huge-file guard), diff against
 *  HEAD, blame, history, plain-text editing (daemon checkpoints first) and
 *"Ask about this" for a selection. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, GitCompareArrows, UserRound, History, Pencil, Check, X, ExternalLink, MessageSquarePlus, FileWarning, Loader2 } from 'lucide-react';
import { useFileRequest } from './useFiles.ts';
import { CodeView } from './CodeView.tsx';
import { AskBox } from './AskBox.tsx';
import { type FileData, type Blame, type FileCommit, type GitMark, GIT_COLOR, GIT_LETTER, baseName, dirName, formatSize, formatDate } from './types.ts';
import { ago } from '../../lib/format.ts';
import { useModalFocus } from '../../lib/useModalFocus.ts';

const mono = { fontFamily: 'var(--font-mono)' } as const;

function Tool({ title, on, disabled, onClick, children }: { title: string; on?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return <button title={title} aria-pressed={on} disabled={disabled} onClick={onClick} className={disabled || on ? undefined : 'hv'} style={{
    border: 'none', width: 24, height: 24, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    background: on ? 'var(--bg-selected)' : 'transparent', color: disabled ? 'var(--text-hint)' : on ? 'var(--text-active)' : 'var(--text-secondary)',
    cursor: disabled ? 'default' : 'pointer',
  }}>{children}</button>;
}

const ERRORS: Record<string, string> = {
  'file.busy': 'The agent is working in this folder; stop the turn before editing.',
  'file.conflict': 'The file changed on disk since you opened it. Reload to see the new version.',
  'file.binary': 'Binary files can’t be edited here.',
};

export function FileView({ session, path, line, initialDiff, git, isGit, onBack: leave, onOpenExternal, onOpenSession, onGoFolder }: {
  session: string; path: string; line?: number; initialDiff?: boolean; git?: GitMark; isGit: boolean; onGoFolder?: (path: string) => void;
  onBack: () => void; onOpenExternal?: () => void; onOpenSession?: (id: string) => void;
}) {
  const request = useFileRequest(session);
  const [data, setData] = useState<FileData>();
  const [error, setError] = useState<string>();
  const [force, setForce] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [blame, setBlame] = useState<Blame>();
  const [commits, setCommits] = useState<FileCommit[]>();
  const [at, setAt] = useState<FileCommit>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState<{ from: number; to: number; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const discardDialog = useRef<HTMLElement>(null);
  useModalFocus(Boolean(discardAction), discardDialog, () => setDiscardAction(null));

  const dirty = editing && draft !== undefined && draft !== data?.content;
  const guard = (fn: () => void) => () => {
    if (!dirty) fn();
    else setDiscardAction(() => fn);
  };
  const discard = () => {
    const action = discardAction;
    setDiscardAction(null); setEditing(false); setDraft(undefined);
    action?.();
  };
  const onBack = guard(leave);
  const load = useCallback(async () => {
    const r = await request<FileData>('file.read', { path, ...(at ? { ref: at.sha } : {}), ...(force ? { force: true } : {}) });
    if (r.error) { setError(r.error); return; }
    setError(undefined); setData(r.body); setDraft(undefined);
  }, [request, path, at, force]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDiff(null); setBlame(undefined); setCommits(undefined); setAt(undefined); setEditing(false); setForce(false); }, [path]);

  const toggleDiff = async () => {
    if (diff !== null) { setDiff(null); return; }
    const r = await request<FileData>('file.read', { path, ref: 'HEAD' });
    setDiff(r.body?.content ?? '');
  };
  useEffect(() => {
    if (!initialDiff) return;
    let active = true;
    void request<FileData>('file.read', { path, ref: 'HEAD' }).then(result => {
      if (active) setDiff(result.body?.content ?? '');
    });
    return () => { active = false; };
  }, [initialDiff, path, request]);
  const toggleBlame = async () => {
    if (blame) { setBlame(undefined); return; }
    const r = await request<Blame>('file.blame', { path });
    if (r.error) setError(r.error); else setBlame(r.body);
  };
  const toggleHistory = async () => {
    if (commits) { setCommits(undefined); setAt(undefined); return; }
    const r = await request<{ commits: FileCommit[] }>('file.history', { path, limit: 50 });
    if (r.error) setError(r.error); else setCommits(r.body!.commits);
  };
  const save = async () => {
    if (!data || draft === undefined || saving) return;
    setSaving(true);
    const r = await request<{ mtime: number }>('file.write', { path, content: draft, ...(data.mtime !== null ? { baseMtime: data.mtime } : {}) });
    setSaving(false);
    if (r.error) { setError(ERRORS[r.code ?? ''] ?? r.error); return; }
    setEditing(false); await load();
  };

  const text = data && data.encoding === 'utf8' ? data.content : null;
  const canEdit = Boolean(text !== null && !at && !data?.binary);
  const dir = dirName(path);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 38, flexShrink: 0, padding: '0 8px 0 6px', borderBottom: '1px solid var(--line-subtle)' }}>
        <Tool title="Back to folder" onClick={onBack}><ArrowLeft size={13} /></Tool>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, flex: 1, padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: git ? GIT_COLOR[git] ?? 'var(--text-title)' : 'var(--text-title)' }}>{baseName(path)}</span>
          {git && GIT_LETTER[git] ? <span style={{ ...mono, fontSize: 10, color: GIT_COLOR[git] }}>{GIT_LETTER[git]}</span> : null}
          <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-hint)', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', gap: 1 }}>{dir ? dir.split('/').map((seg, i, all) => <span key={i}>{i ? '/' : ''}<span className="ormi-file-link" title={`Show ${all.slice(0, i + 1).join('/')}`} onClick={guard(() => onGoFolder?.(all.slice(0, i + 1).join('/')))}>{seg}</span></span>) : null}</span>
        </span>
        {editing ? <>
          {saving ? <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-hint)' }} /> : null}
          <button onClick={() => { setEditing(false); setDraft(undefined); }} className="hv" style={{ ...btn }}><X size={12} />Cancel</button>
          <button onClick={() => void save()} disabled={draft === undefined || saving} style={{ ...btn, background: 'var(--text-title)', color: 'var(--bg-main)', fontWeight: 600, opacity: draft === undefined ? 0.8 : 1 }}><Check size={12} />Save</button>
        </> : <>
          <Tool title="Ask about the selected lines" disabled={!sel} onClick={() => setAsking(true)}><MessageSquarePlus size={13} /></Tool>
          {isGit ? <Tool title="Diff against HEAD" on={diff !== null} disabled={!text || Boolean(at)} onClick={() => void toggleDiff()}><GitCompareArrows size={13} /></Tool> : null}
          {isGit ? <Tool title="Blame" on={Boolean(blame)} disabled={!text || Boolean(at)} onClick={() => void toggleBlame()}><UserRound size={13} /></Tool> : null}
          {isGit ? <Tool title="File history" on={Boolean(commits)} onClick={() => void toggleHistory()}><History size={13} /></Tool> : null}
          <span style={{ width: 1, height: 14, background: 'var(--line-card)', margin: '0 3px', flexShrink: 0 }} />
          <Tool title="Edit (a checkpoint is taken before saving)" disabled={!canEdit} onClick={() => { setDiff(null); setBlame(undefined); setEditing(true); }}><Pencil size={12} /></Tool>
          {onOpenExternal ? <Tool title="Open in external editor" onClick={onOpenExternal}><ExternalLink size={12} /></Tool> : null}
        </>}
      </div>
      {at ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px 0 12px', fontSize: 11.5, color: 'var(--accent-amber)', background: 'var(--tint-amber)', flexShrink: 0 }}>
        <History size={12} style={{ flexShrink: 0 }} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Viewing <span style={mono}>{at.sha.slice(0, 7)}</span> · {at.subject}</span><span style={{ flex: 1 }} />
        <button className="hv" style={btn} onClick={() => setAt(undefined)}>Back to working copy</button>
      </div> : null}
      {error ? <div style={{ minHeight: 32, padding: '4px 8px 4px 12px', boxSizing: 'border-box', fontSize: 11.5, color: 'var(--accent-red)', background: 'var(--tint-red)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {error}<span style={{ flex: 1 }} /><button className="hv" style={btn} onClick={() => { setError(undefined); void load(); }}>Reload</button>
      </div> : null}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-inset)' }}>
          {!data ? (error ? null : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-hint)' }}><Loader2 size={14} className="animate-spin" /></div>)
            : data.tooLarge ? <Placeholder icon={<FileWarning size={18} />} title={`${formatSize(data.size)} — too large to show here`}
                action={data.size <= 10 * 1024 * 1024 ? <button className="hv" style={{ ...btn, background: 'var(--bg-chip)', color: 'var(--text-title)' }} onClick={() => setForce(true)}>Open anyway</button> : undefined} />
            : data.encoding === 'base64' && data.mime?.startsWith('image/') ? <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
                <img alt={baseName(path)} src={`data:${data.mime};base64,${data.content}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} /></div>
            : text === null ? <Placeholder icon={<FileWarning size={18} />} title="Binary file" sub={`${data.mime ?? 'unknown type'} · ${formatSize(data.size)}${data.mtime ? ` · ${formatDate(data.mtime)}` : ''}`} />
            : <CodeView path={path} doc={text} editable={editing} line={line} original={diff ?? undefined} blame={blame}
                onChange={d => setDraft(d)} onSelection={setSel} onSave={() => void save()} />}
        </div>
        {asking && sel ? <AskBox session={session} path={path} sel={sel} onClose={() => setAsking(false)} onStarted={id => { setAsking(false); onOpenSession?.(id); }} /> : null}
        {commits ? <div style={{ maxHeight: '42%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px 0 12px', flexShrink: 0 }}>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: 0.6, color: 'var(--text-hint)' }}>HISTORY</span>
            <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--bg-chip)', color: 'var(--text-hint)' }}>{commits.length}</span>
            <span style={{ flex: 1 }} />
            <Tool title="Close history" onClick={() => void toggleHistory()}><X size={12} /></Tool>
          </div>
          <div style={{ overflowY: 'auto', padding: '0 6px 6px' }}>
            {!commits.length ? <div style={{ padding: '4px 6px 8px', fontSize: 11.5, color: 'var(--text-hint)' }}>No commits touch this file yet.</div> : null}
            {commits.map(c => (
              <div key={c.sha} onClick={() => setAt(c)} className={at?.sha === c.sha ? undefined : 'hv-row'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 7, cursor: 'pointer', background: at?.sha === c.sha ? 'var(--bg-selected)' : 'transparent' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                  <span style={{ display: 'block', ...mono, fontSize: 10.5, color: 'var(--text-hint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sha.slice(0, 7)} · {c.author} · {ago(c.ts)}</span>
                </span>
                {c.session ? <button title="Open the session that made this commit" onClick={e => { e.stopPropagation(); onOpenSession?.(c.session!); }} className="hv" style={{ ...btn, height: 22, padding: '0 7px', fontSize: 10.5, background: 'var(--bg-chip)' }}>session</button> : null}
              </div>
            ))}
          </div>
        </div> : null}
      </div>
      {discardAction ? <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDiscardAction(null); }} style={{
        position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', padding: 20, background: 'var(--modal-scrim)',
      }}>
        <section ref={discardDialog} role="dialog" aria-modal="true" aria-label="Discard unsaved changes" style={{
          width: 'min(360px, 100%)', padding: 20, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--line-card)',
          color: 'var(--text-active)', boxShadow: '0 16px 48px var(--shadow-color)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Discard unsaved changes?</div>
          <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--text-secondary)' }}>Your edits to {baseName(path)} will be lost.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setDiscardAction(null)} style={btn}>Keep editing</button>
            <button onClick={discard} style={{ ...btn, background: 'var(--text-title)', color: 'var(--bg-main)', fontWeight: 600 }}>Discard changes</button>
          </div>
        </section>
      </div> : null}
    </div>
  );
}

const btn = { font: 'inherit', fontSize: 11, height: 24, padding: '0 8px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-label)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 };

function Placeholder({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 22px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--line-card)', color: 'var(--text-hint)', fontSize: 11.5, textAlign: 'center', maxWidth: 320 }}>
      <span style={{ marginBottom: 2 }}>{icon}</span><span style={{ color: 'var(--text-title)', fontSize: 12.5, fontWeight: 500 }}>{title}</span>{sub ? <span>{sub}</span> : null}
      {action ? <span style={{ marginTop: 6 }}>{action}</span> : null}
    </div>
  </div>;
}
