/** Git side panel (Desktop — Git mockups): Changes, History, Branches, PR and
 *  Stash tabs over the daemon's git.* methods for the session's folder. */
import { useState } from 'react';
import { GitCompareArrows, History, GitBranch, GitPullRequest, Archive, type LucideIcon } from 'lucide-react';
import { useGit, type Pr } from './useGit.ts';
import { ChangesTab, type DiffData } from './ChangesTab.tsx';
import { HistoryTab } from './HistoryTab.tsx';
import { BranchesTab, type BranchData } from './BranchesTab.tsx';
import { PrTab } from './PrTab.tsx';
import { StashTab } from './StashTab.tsx';
import { Count } from './parts.tsx';

type Tab = 'changes' | 'history' | 'branches' | 'pr' | 'stash';

export function GitPane({ session }: { session: string }) {
  const [tab, setTab] = useState<Tab>('changes');
  const diff = useGit<DiffData>(session, 'git.diff');
  const branches = useGit<BranchData>(session, 'git.branches', {}, 15000);
  const pr = useGit<{ pr: Pr | null }>(session, 'git.prStatus', {}, 30000);
  const TABS: { id: Tab; label: string; icon: LucideIcon; count?: string; mint?: boolean }[] = [
    { id: 'changes', label: 'Changes', icon: GitCompareArrows, count: diff.data ? String(diff.data.files.length) : undefined },
    { id: 'history', label: 'History', icon: History },
    { id: 'branches', label: 'Branches', icon: GitBranch, count: branches.data ? String(branches.data.local.length) : undefined },
    { id: 'pr', label: 'PR', icon: GitPullRequest, count: pr.data?.pr ? `#${pr.data.pr.number}` : undefined },
    { id: 'stash', label: 'Stash', icon: Archive },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ormi-tabs" style={{ display: 'flex', height: 38, boxSizing: 'border-box', borderBottom: '1px solid var(--line-subtle)', padding: '0 4px', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 37, flexShrink: 0, border: 'none', borderRadius: 6, background: tab === id ? 'var(--bg-selected)' : 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 11.5, whiteSpace: 'nowrap',
            color: tab === id ? 'var(--text-active)' : 'var(--text-secondary)', fontWeight: tab === id ? 500 : 400,
            borderBottom: '1.5px solid transparent',
          }}><Icon size={12} className="ormi-pane-narrow-hide" />{label}{count ? <span className={id === 'pr' ? undefined : 'ormi-pane-narrow-hide'} style={{ display: 'inline-flex' }}><Count>{count}</Count></span> : null}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'changes' ? <ChangesTab session={session} diff={diff.data} reloadDiff={diff.reload} />
          : tab === 'history' ? <HistoryTab session={session} branch={branches.data?.current ?? null} />
          : tab === 'branches' ? <BranchesTab session={session} data={branches.data} error={branches.error} reload={branches.reload} />
          : tab === 'pr' ? <PrTab session={session} pr={pr.error ? undefined : pr.data?.pr} error={pr.error} reload={pr.reload} />
          : <StashTab session={session} />}
      </div>
    </div>
  );
}
