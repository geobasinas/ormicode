/** Changes tab: files changed since the session's base, the selected file's
 *  diff, the staging summary and the commit form (Desktop — Git mockup). */
import { useState } from 'react';
import { ArrowRight, GitBranch, RefreshCw, Sparkles, Undo2, ChevronDown, Users, Link2 } from 'lucide-react';
import { useGit, useGitAction, type FileStat } from './useGit.ts';
import { DiffView } from './DiffView.tsx';
import { Btn, card, FileRow, Footer, Header, hint, IconBtn, mono, Notice, scroll, Stat } from './parts.tsx';

interface Status { branch: string | null; base: string | null; aheadOfBase: number; files: { path: string; staged: boolean; unstaged: boolean }[]; staged: { added: number; removed: number; files: number } }
export interface DiffData { files: FileStat[]; patch: string; truncated?: boolean }

export function ChangesTab({ session, diff, reloadDiff }: { session: string; diff: DiffData | null; reloadDiff: () => Promise<void> }) {
  const status = useGit<Status>(session, 'git.status');
  const act = useGitAction(session);
  const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [amend, setAmend] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'red' | 'hint' } | null>(null);
  const st = status.data; const files = diff?.files ?? [];
  const unstaged = st?.files.filter(f => f.unstaged || !f.staged).length ?? 0;
  const refresh = async () => { await Promise.all([status.reload(), reloadDiff()]); };
  const run = async (method: string, b: Record<string, unknown> = {}, ok?: string) => {
    const r = await act(method, b); setMsg(r.error ? { text: r.error, tone: 'red' } : ok ? { text: ok, tone: 'hint' } : null); await refresh(); return !r.error;
  };
  const commit = async (push: boolean) => {
    const message = body.trim() ? `${title.trim()}\n\n${body.trim()}` : title.trim();
    if (!(await run('git.commit', { message, amend }, 'Committed'))) return;
    setTitle(''); setBody(''); setAmend(false);
    if (push) await run('git.push', {}, 'Committed and pushed');
  };
  const canCommit = !!title.trim() && ((st?.staged.files ?? 0) > 0 || amend);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Changes" count={`${files.length} files`}>
        <Stat added={files.reduce((a, f) => a + f.added, 0)} removed={files.reduce((a, f) => a + f.removed, 0)} />
        <IconBtn title="Refresh" onClick={() => void refresh()}><RefreshCw size={13} /></IconBtn>
      </Header>
      <div style={scroll}>
        {st?.branch ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 8px' }}>
          <span style={{ ...mono, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-chip)', color: 'var(--text-label)', minWidth: 0, whiteSpace: 'nowrap' }}><GitBranch size={11} style={{ flexShrink: 0 }} /><span className="ormi-chip-text">{st.branch}</span></span>
          {st.base ? <><ArrowRight size={11} style={{ color: 'var(--text-hint)', flexShrink: 0 }} /><span className="ormi-chip-text" style={{ ...mono, ...hint, whiteSpace: 'nowrap' }}>{st.base}</span></> : null}
          <span style={{ flex: 1 }} /><span style={{ ...hint, whiteSpace: 'nowrap', flexShrink: 0 }}>{st.aheadOfBase ? `${st.aheadOfBase} commit${st.aheadOfBase > 1 ? 's' : ''} ahead` : ''}</span>
        </div> : null}
        {status.error ? <Notice tone="red">{status.error}</Notice> : null}
        {files.length ? files.map(f => <FileRow key={f.path} {...f} active={sel === f.path} onClick={() => setSel(s => s === f.path ? null : f.path)} />) : <Notice>No changes since the session started</Notice>}
        {diff && files.length ? <div style={{ marginTop: 8 }}><DiffView patch={diff.patch} only={sel ?? undefined} truncated={diff.truncated} /></div> : null}
      </div>
      <div style={{ padding: '8px 12px 0', borderTop: '1px solid var(--line-subtle)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{st?.staged.files ?? 0} files staged</span>
          <Stat added={st?.staged.added ?? 0} removed={st?.staged.removed ?? 0} />
          <span style={{ flex: 1 }} />
          {unstaged ? <Btn onClick={() => void run('git.stage')}>Stage all ({unstaged})</Btn> : null}
          <Btn disabled title="Needs the utility model — soon"><Sparkles size={12} />Generate</Btn>
        </div>
        <div style={{ ...card, padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Commit message" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-title)', font: 'inherit', fontSize: 12.5, fontWeight: 500 }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) void commit(false); }} />
            <span style={{ ...mono, ...hint, fontSize: 10, color: title.length > 72 ? 'var(--accent-amber)' : 'var(--text-hint)' }}>{title.length}/72</span>
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Description (optional)" rows={3} style={{ width: '100%', marginTop: 6, resize: 'none', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-label)', font: 'inherit', fontSize: 11.5, lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 12, ...hint }}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', opacity: 0.5 }} title="soon"><Users size={11} />Co-author</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', opacity: 0.5 }} title="soon"><Link2 size={11} />Link issue</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0', ...hint }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" className="ormi-check" checked={amend} onChange={e => setAmend(e.target.checked)} />Amend last commit</label>
          <span style={{ flex: 1 }} />{st?.branch ? <span style={{ ...mono, display: 'inline-flex', gap: 4, alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}><GitBranch size={11} style={{ flexShrink: 0 }} /><span className="ormi-chip-text">{st.branch}</span></span> : null}
        </div>
        {msg ? <div style={{ fontSize: 11, color: msg.tone === 'red' ? 'var(--accent-red)' : 'var(--text-hint)', paddingBottom: 6 }}>{msg.text}</div> : null}
      </div>
      <Footer>
        <IconBtn title="Unstage all" onClick={() => void run('git.unstage')} disabled={!st?.staged.files}><Undo2 size={14} /></IconBtn>
        <span style={{ flex: 1 }} />
        <Btn disabled={!canCommit} onClick={() => void commit(false)}>Commit <span className="ormi-pane-narrow-hide" style={{ ...hint, fontSize: 10 }}>Ctrl ↵</span></Btn>
        <Btn primary disabled={!canCommit} onClick={() => void commit(true)}>Commit and push<ChevronDown size={12} /></Btn>
      </Footer>
    </div>
  );
}
