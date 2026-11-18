/** Stash tab: stash list, contents of the selected stash, apply/pop/drop. */
import { useState } from 'react';
import { ArrowUp, Plus, Trash2, Download, GitBranch } from 'lucide-react';
import { useGit, useGitAction, type FileStat, type Stash } from './useGit.ts';
import { DiffView } from './DiffView.tsx';
import { Btn, FileRow, Footer, Header, hint, mono, Notice, scroll, Stat } from './parts.tsx';
import { ago } from '../../lib/format.ts';

export function StashTab({ session }: { session: string }) {
  const list = useGit<{ stashes: Stash[] }>(session, 'git.stash', { op: 'list' });
  const act = useGitAction(session);
  const [sel, setSel] = useState(0);
  const stashes = list.data?.stashes ?? [];
  const cur = stashes.find(s => s.index === sel) ?? stashes[0];
  const show = useGit<{ files: FileStat[]; patch: string; truncated: boolean }>(session, 'git.stash', { op: 'show', index: cur?.index ?? 0 }, 0);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (op: string, extra: Record<string, unknown> = {}) => {
    const r = await act('git.stash', { op, ...extra }); setMsg(r.error ?? null); await list.reload(); if (op !== 'push') setSel(0);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Stash" count={`${stashes.length} stashes`}><Btn primary onClick={() => void run('push', { includeUntracked: true })}><Plus size={12} />Stash changes</Btn></Header>
      {list.error ? <Notice tone="red">{list.error}</Notice> : null}
      <div style={scroll}>
        {stashes.map(s => (
          <div key={s.ref} onClick={() => setSel(s.index)} className={cur?.index === s.index ? undefined : 'hv'} style={{ padding: '7px 12px', margin: '0 6px', borderRadius: 7, cursor: 'pointer', background: cur?.index === s.index ? 'var(--bg-raised)' : 'transparent' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ ...mono, ...hint, fontSize: 10.5 }}>{s.ref}</span>
              <span style={{ fontSize: 12, color: 'var(--text-title)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.message}</span>
              <span style={hint}>{ago(s.ts)}</span>
            </div>
            <div style={{ ...hint, display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
              <GitBranch size={10} /><span style={mono}>{s.branch}</span> · {s.files} file{s.files === 1 ? '' : 's'} <Stat added={s.added} removed={s.removed} />
            </div>
          </div>
        ))}
        {stashes.length ? null : <Notice>No stashes</Notice>}
        {cur && show.data ? <>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-title)', padding: '14px 12px 6px' }}>Contents of {cur.ref}</div>
          {show.data.files.map(f => <FileRow key={f.path} {...f} />)}
          <div style={{ marginTop: 8 }}><DiffView patch={show.data.patch} truncated={show.data.truncated} /></div>
        </> : null}
      </div>
      {msg ? <Notice tone="red">{msg}</Notice> : null}
      <Footer>
        <Btn disabled={!cur} onClick={() => cur && void run('apply', { index: cur.index })}><Download size={12} />Apply</Btn>
        <Btn primary disabled={!cur} onClick={() => cur && void run('pop', { index: cur.index })}><ArrowUp size={12} />Pop</Btn>
        <span style={{ flex: 1 }} />
        <Btn danger disabled={!cur} onClick={() => cur && void run('drop', { index: cur.index })}><Trash2 size={12} />Drop</Btn>
      </Footer>
    </div>
  );
}
