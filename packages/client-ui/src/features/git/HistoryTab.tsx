/** History tab: commit list (mint dot = unpushed) and the selected commit's
 *  files with cherry-pick / revert / copy hash (Desktop — Git · History). */
import { useState } from 'react';
import { GitBranch, Search, GitCommitHorizontal, Undo2, Copy } from 'lucide-react';
import { useGit, useGitAction, type Commit, type FileStat, type GitResult } from './useGit.ts';
import { Btn, card, FileRow, Footer, Header, hint, IconBtn, mono, Notice, scroll } from './parts.tsx';
import { agoText } from '../../lib/format.ts';

interface Shown { sha: string; subject: string; author: string; ts: number; files: FileStat[] }

export function HistoryTab({ session, branch }: { session: string; branch: string | null }) {
  const log = useGit<{ commits: Commit[]; total: number }>(session, 'git.log', { limit: 100 });
  const act = useGitAction(session);
  const [sel, setSel] = useState<string | null>(null);
  const shown = useGit<Shown>(session, 'git.show', { sha: sel ?? 'HEAD' }, 0);
  const [q, setQ] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const commits = (log.data?.commits ?? []).filter(c => !q || `${c.subject} ${c.author} ${c.sha}`.toLowerCase().includes(q.toLowerCase()));
  const apply = async (method: string, sha: string) => {
    const r = await act<GitResult>(method, { commits: [sha] });
    setMsg(r.error ?? (r.body?.state === 'conflict' ? `Conflict in ${r.body.conflict.files.length} files — resolve in the terminal or abort` : 'Done'));
    await log.reload();
  };
  const d = shown.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="History" count={`${log.data?.total ?? 0} commits`}>
        {branch ? <span style={{ ...mono, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--line-card)', color: 'var(--text-label)' }}><GitBranch size={11} />{branch}</span> : null}
        <IconBtn title="Filter" onClick={() => setQ(v => v === null ? '' : null)}><Search size={13} /></IconBtn>
      </Header>
      {q !== null ? <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Filter commits" style={{ margin: '0 12px 6px', padding: '6px 10px', borderRadius: 7, border: '1px solid var(--line-card)', background: 'var(--bg-inset)', color: 'var(--text-label)', font: 'inherit', fontSize: 12, outline: 'none' }} /> : null}
      {log.error ? <Notice tone="red">{log.error}</Notice> : null}
      <div style={scroll}>
        {commits.map(c => (
          <div key={c.sha} onClick={() => setSel(c.sha)} className={sel === c.sha ? undefined : 'hv'} style={{ display: 'flex', gap: 10, padding: '7px 12px', cursor: 'pointer', borderRadius: 6, background: sel === c.sha ? 'var(--bg-raised)' : 'transparent' }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0, background: c.pushed ? 'var(--text-hint)' : 'var(--accent-mint)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</div>
              <div style={{ ...hint, display: 'flex', gap: 6, alignItems: 'center' }}>{c.author} · {agoText(c.ts)}
                {c.pushed ? null : <span style={{ fontSize: 9.5, padding: '0 5px', borderRadius: 4, background: 'var(--tint-mint)', color: 'var(--accent-mint)' }}>unpushed</span>}
              </div>
            </div>
            <span style={{ ...mono, ...hint, fontSize: 10.5 }}>{c.sha.slice(0, 7)}</span>
          </div>
        ))}
      </div>
      {d ? <div style={{ borderTop: '1px solid var(--line-subtle)', padding: '10px 12px 4px', flexShrink: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-title)', marginBottom: 6 }}>{d.subject}</div>
        <div style={{ ...hint, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, background: 'var(--bg-chip)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{d.author.slice(0, 1).toUpperCase()}</span>
          {d.author} committed {agoText(d.ts)}<span style={{ flex: 1 }} /><span style={mono}>{d.sha.slice(0, 7)}</span>
        </div>
        <div style={{ ...card, maxHeight: 120, overflowY: 'auto' }}>{d.files.map(f => <FileRow key={f.path} {...f} />)}</div>
        {msg ? <div style={{ ...hint, paddingTop: 6 }}>{msg}</div> : null}
      </div> : null}
      <Footer>
        <Btn disabled={!d} onClick={() => d && void apply('git.cherryPick', d.sha)}><GitCommitHorizontal size={12} />Cherry-pick</Btn>
        <Btn disabled={!d} onClick={() => d && void apply('git.revert', d.sha)}><Undo2 size={12} />Revert</Btn>
        <span style={{ flex: 1 }} />
        <Btn disabled={!d} onClick={() => d && void navigator.clipboard.writeText(d.sha).then(() => setMsg('Hash copied'))}><Copy size={12} />Copy hash</Btn>
      </Footer>
    </div>
  );
}
