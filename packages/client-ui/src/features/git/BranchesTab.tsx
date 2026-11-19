/** Branches tab: current / local / remote with ahead-behind, filter, new
 *  branch, checkout, merge into current, delete with typed confirmation. */
import { useState } from 'react';
import { Check, Cloud, GitBranch, GitMerge, LogIn, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useGitAction, type Branch, type GitResult } from './useGit.ts';
import { Btn, Footer, Header, hint, IconBtn, mono, Notice, scroll, Section } from './parts.tsx';
import { ago } from '../../lib/format.ts';

export interface BranchData { current: string | null; local: Branch[]; remote: Branch[] }
const input = { padding: '6px 10px', borderRadius: 7, border: '1px solid var(--line-card)', background: 'var(--bg-inset)', color: 'var(--text-label)', font: 'inherit', fontSize: 12, outline: 'none' } as const;

function Row({ b, remote, active, onClick }: { b: Branch; remote?: boolean; active: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={active ? undefined : 'hv'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', margin: '0 6px', borderRadius: 7, cursor: 'pointer', background: active ? 'var(--bg-selected)' : 'transparent', color: active ? 'var(--text-active)' : undefined }}>
      {remote ? <Cloud size={12} style={{ color: 'var(--text-hint)' }} /> : <GitBranch size={12} style={{ color: 'var(--text-hint)' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...mono, fontSize: 11.5, color: remote ? 'var(--text-secondary)' : 'var(--text-title)' }}>{b.name}</div>
        {remote ? null : <div style={{ ...hint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={mono}>{b.sha.slice(0, 7)}</span> · {b.subject} · {ago(b.ts)}</div>}
      </div>
      {remote ? <span style={hint}>{ago(b.ts)}</span> : <span style={{ ...mono, ...hint, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {b.gone ? 'gone' : null}{b.ahead ? `↑${b.ahead}` : null}{b.behind ? `↓${b.behind}` : null}{b.current ? <Check size={12} /> : null}
      </span>}
    </div>
  );
}

export function BranchesTab({ session, data, error, reload }: { session: string; data: BranchData | null; error: string | null; reload: () => Promise<void> }) {
  const act = useGitAction(session);
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null); const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const f = (b: Branch) => !q || b.name.toLowerCase().includes(q.toLowerCase());
  const cur = data?.local.find(b => b.current); const local = (data?.local ?? []).filter(b => !b.current && f(b));
  const run = async (method: string, body: Record<string, unknown>, ok: string) => {
    const r = await act<GitResult>(method, body);
    setMsg(r.error ?? (r.body && 'state' in r.body && r.body.state === 'conflict' ? `Conflict in ${r.body.conflict.files.length} files — resolve or abort` : ok));
    await reload(); return !r.error;
  };
  const selected = data?.local.find(b => b.name === sel) ?? data?.remote.find(b => b.name === sel);
  const isRemote = !!data?.remote.find(b => b.name === sel);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Branches" count={`${data?.local.length ?? 0} local · ${data?.remote.length ?? 0} remote`}>
        <IconBtn title="Refresh" onClick={() => void reload()}><RefreshCw size={13} /></IconBtn>
      </Header>
      <div style={{ display: 'flex', gap: 8, padding: '0 12px 6px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-hint)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter branches" style={{ ...input, width: '100%', paddingLeft: 28 }} />
        </div>
        <Btn primary onClick={() => setCreating('')}><Plus size={12} />New branch</Btn>
      </div>
      {creating !== null ? <form style={{ display: 'flex', gap: 8, padding: '0 12px 6px' }} onSubmit={e => { e.preventDefault(); void run('git.createBranch', { name: creating }, `Created ${creating}`).then(ok => ok && setCreating(null)); }}>
        <input autoFocus value={creating} onChange={e => setCreating(e.target.value)} placeholder="new-branch-name" style={{ ...input, ...mono, flex: 1 }} />
        <Btn disabled={!creating.trim()}>Create</Btn><Btn onClick={() => setCreating(null)}>Cancel</Btn>
      </form> : null}
      {error ? <Notice tone="red">{error}</Notice> : null}
      <div style={scroll}>
        {cur ? <><Section>Current</Section><Row b={cur} active={sel === cur.name} onClick={() => setSel(cur.name)} /></> : null}
        {local.length ? <Section>Local</Section> : null}
        {local.map(b => <Row key={b.name} b={b} active={sel === b.name} onClick={() => setSel(b.name)} />)}
        {data?.remote.filter(f).length ? <Section>Remote · origin</Section> : null}
        {data?.remote.filter(f).map(b => <Row key={b.name} b={b} remote active={sel === b.name} onClick={() => setSel(b.name)} />)}
      </div>
      {confirm !== null && selected ? <form style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--line-subtle)' }} onSubmit={e => { e.preventDefault(); void run('git.deleteBranch', { name: selected.name, confirm }, `Deleted ${selected.name}`).then(() => { setConfirm(null); setSel(null); }); }}>
        <input autoFocus value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`type ${selected.name} to delete`} style={{ ...input, ...mono, flex: 1 }} />
        <Btn danger disabled={confirm !== selected.name}>Delete</Btn><Btn onClick={() => setConfirm(null)}>Cancel</Btn>
      </form> : null}
      {msg ? <Notice>{msg}</Notice> : null}
      <Footer>
        <Btn disabled={!selected || selected.current || isRemote} onClick={() => selected && void run('git.checkout', { branch: selected.name }, `On ${selected.name}`)}><LogIn size={12} />Checkout</Btn>
        <Btn disabled={!selected || selected.current} onClick={() => selected && void run('git.merge', { branch: selected.name }, `Merged ${selected.name}`)}><GitMerge size={12} />Merge into current</Btn>
        <span style={{ flex: 1 }} />
        <Btn danger disabled={!selected || selected.current || isRemote} onClick={() => setConfirm('')}><Trash2 size={12} />Delete</Btn>
      </Footer>
    </div>
  );
}
