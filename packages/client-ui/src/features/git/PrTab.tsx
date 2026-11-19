/** PR tab: the branch's pull request via gh — checks, reviewers, files and
 *  squash-merge; or a create form when there is none (Git · Pull request). */
import { useState, type ReactElement } from 'react';
import { ArrowRight, CircleCheck, CircleX, ExternalLink, GitBranch, GitMerge, GitPullRequest, Loader, TriangleAlert, Check } from 'lucide-react';
import { useGitAction, type Pr } from './useGit.ts';
import { Btn, card, Footer, Header, hint, IconBtn, mono, Notice, scroll, Stat } from './parts.tsx';
import { agoText } from '../../lib/format.ts';

const CHECK_ICON: Record<string, ReactElement> = {
  pass: <CircleCheck size={13} style={{ color: 'var(--accent-mint)' }} />, fail: <CircleX size={13} style={{ color: 'var(--accent-red)' }} />,
  pending: <Loader size={13} style={{ color: 'var(--accent-amber)' }} />, skipped: <CircleCheck size={13} style={{ color: 'var(--text-hint)' }} />,
};
const REVIEW: Record<string, [string, string]> = { approved: ['Approved', 'var(--accent-mint)'], changes_requested: ['Changes requested', 'var(--accent-red)'], commented: ['Commented', 'var(--text-hint)'], requested: ['Review requested', 'var(--accent-amber)'] };
const dur = (ms: number | null) => ms == null ? '' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s`;

function Create({ session, reload }: { session: string; reload: () => Promise<void> }) {
  const act = useGitAction(session);
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (busy || !title.trim()) return;
    setBusy(true); setErr(null);
    try {
      const result = await act('git.pr', { title, body });
      setErr(result.error ?? null);
      if (!result.error) await reload();
    } finally { setBusy(false); }
  };
  const field = { width: '100%', background: 'var(--bg-inset)', border: '1px solid var(--line-card)', borderRadius: 7, color: 'var(--text-label)', font: 'inherit', fontSize: 12, padding: '7px 10px', outline: 'none' } as const;
  return (
    <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Notice>No pull request for this branch yet.</Notice>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={field} />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Description" rows={5} style={{ ...field, resize: 'vertical' }} />
      {err ? <Notice tone="red">{err}</Notice> : null}
      <div><Btn primary disabled={!title.trim() || busy} onClick={() => void create()}><GitPullRequest size={12} />{busy ? 'Creating…' : 'Create pull request'}</Btn></div>
    </div>
  );
}

export function PrTab({ session, pr, error, reload }: { session: string; pr: Pr | null | undefined; error: string | null; reload: () => Promise<void> }) {
  const act = useGitAction(session);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const merge = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const result = await act('git.prMerge', { method: 'squash' });
      setMsg(result.error ?? 'Merged');
      await reload();
    } finally { setBusy(false); }
  };
  if (error) return <div><Header title="Pull request" /><Notice tone="amber">{error}</Notice></div>;
  if (pr === undefined) return <div><Header title="Pull request" /><Notice>Loading…</Notice></div>;
  if (pr === null) return <div><Header title="Pull request" /><Create session={session} reload={reload} /></div>;
  const passing = pr.checks.filter(c => c.state === 'pass').length; const pending = pr.checks.some(c => c.state === 'pending');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Pull request" count={`#${pr.number}`}>
        <span style={{ fontSize: 10.5, padding: '1px 8px', borderRadius: 10, background: 'var(--bg-chip)', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{pr.state}</span>
        <IconBtn title="Open on GitHub" onClick={() => window.open(pr.url)}><ExternalLink size={13} /></IconBtn>
      </Header>
      <div style={{ ...scroll, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-title)' }}>{pr.title}</div>
        <div style={{ ...hint, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...mono, display: 'inline-flex', gap: 4, alignItems: 'center', padding: '1px 6px', borderRadius: 5, background: 'var(--bg-chip)' }}><GitBranch size={10} />{pr.head}</span>
          <ArrowRight size={10} /><span style={mono}>{pr.base}</span> · opened {agoText(pr.createdAt)} by {pr.author}
        </div>
        {pr.body ? <div style={{ fontSize: 12, color: 'var(--text-label)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{pr.body}</div> : null}
        <div style={{ ...card, padding: '8px 10px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-title)', marginBottom: 6 }}>Checks <span style={hint}>{passing} of {pr.checks.length} passing</span></div>
          {pr.checks.map(c => <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11.5 }}>{CHECK_ICON[c.state] ?? CHECK_ICON.skipped}<span style={{ flex: 1 }}>{c.name}</span><span style={{ ...mono, ...hint, color: c.state === 'pending' ? 'var(--accent-amber)' : 'var(--text-hint)' }}>{c.state === 'pending' ? 'running' : dur(c.durationMs)}</span></div>)}
          {pr.checks.length ? null : <div style={hint}>No checks</div>}
        </div>
        <div style={{ ...card, padding: '8px 10px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-title)', marginBottom: 6 }}>Reviewers</div>
          {pr.reviewers.map(r => <div key={r.login} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11.5 }}>
            <span style={{ width: 16, height: 16, borderRadius: 8, background: 'var(--bg-chip)', fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.login.slice(0, 1).toUpperCase()}</span>
            <span style={{ flex: 1 }}>{r.login}</span><span style={{ fontSize: 10.5, color: REVIEW[r.state]?.[1], display: 'inline-flex', gap: 4, alignItems: 'center' }}>{r.state === 'approved' ? <Check size={11} /> : null}{REVIEW[r.state]?.[0] ?? r.state}</span>
          </div>)}
          {pr.reviewers.length ? null : <div style={hint}>No reviewers</div>}
        </div>
        <div style={{ ...card, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}><GitPullRequest size={12} style={{ color: 'var(--text-hint)' }} /><span style={{ flex: 1 }}>{pr.changedFiles} files changed</span><Stat added={pr.additions} removed={pr.deletions} /></div>
        {msg ? <Notice>{msg}</Notice> : null}
      </div>
      <Footer>
        <Btn disabled title="soon">Close</Btn><span style={{ flex: 1 }} />
        {pending ? <span style={{ fontSize: 10.5, color: 'var(--accent-amber)', display: 'inline-flex', gap: 4, alignItems: 'center' }}><TriangleAlert size={11} />Waiting on checks</span> : null}
        <Btn primary disabled={pr.state !== 'open' || busy} onClick={() => void merge()}><GitMerge size={12} />{busy ? 'Merging…' : 'Squash and merge'}</Btn>
      </Footer>
    </div>
  );
}
