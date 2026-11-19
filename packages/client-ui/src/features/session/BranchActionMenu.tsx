import { Copy, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import type { BranchInfo, RepoInfo } from './GitWorkspacePopover.tsx';

export type BranchMenuAction = 'start' | 'branch' | 'worktree' | 'pull' | 'rename' | 'delete';

export function BranchActionMenu({ branch, info, onAction, management = true, pulling = false }: {
  branch: BranchInfo; info: RepoInfo; onAction: (action: BranchMenuAction, branch: BranchInfo) => void;
  management?: boolean; pulling?: boolean;
}) {
  const local = info.local.some(item => item.name === branch.name);
  const remoteLocal = !local && branch.name.includes('/') ? branch.name.slice(branch.name.indexOf('/') + 1) : undefined;
  const nameCollision = Boolean(remoteLocal && info.local.some(item => item.name === remoteLocal));
  const busy = info.busyBranches.includes(branch.name) || Boolean(remoteLocal && info.busyBranches.includes(remoteLocal));
  const startReason = info.current && info.busyBranches.includes(info.current) ? `${info.current} is in use by another session`
    : busy ? `${branch.name} is in use by another session`
      : nameCollision ? `Local branch ${remoteLocal} already exists; select it instead` : undefined;
  const mutateReason = !local ? 'Only local branches can be changed'
    : busy ? `${branch.name} is in use by another session`
      : branch.worktreePath ? `Checked out in ${branch.worktreePath}` : undefined;
  const pullReason = !local ? 'Pull is available for local branches'
    : !branch.upstream || branch.gone ? 'No upstream is configured'
      : busy || branch.worktreePath ? 'Branch is in use by a live session or worktree' : undefined;
  const item = (action: BranchMenuAction, text: string, disabledReason?: string, spinning = false) => (
    <DropdownMenuItem key={action} disabled={Boolean(disabledReason) || spinning} title={disabledReason}
      onSelect={() => onAction(action, branch)} style={{ fontSize: 11, paddingTop: 6, paddingBottom: 6 }}>
      {spinning ? <span className="animate-spin">◌</span> : <span style={{ width: 13 }} />}
      <span>{text}</span>
      {disabledReason ? <span style={{ marginLeft: 'auto', color: 'var(--text-hint)', fontSize: 9 }}>unavailable</span> : null}
    </DropdownMenuItem>
  );
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className="hv-sub" aria-label={`Actions for ${branch.name}`} title="Branch actions" style={{
        border: 0, background: 'transparent', color: 'var(--text-hint)', width: 22, height: 22,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, cursor: 'pointer',
      }}><MoreHorizontal size={14} /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="bottom" style={{ minWidth: 220, zIndex: 90 }}>
      {item('start', 'Start here (Local checkout)', startReason)}
      {item('branch', 'New branch from here', info.current && info.busyBranches.includes(info.current) ? `${info.current} is in use by another session` : undefined)}
      {item('worktree', 'New worktree from here')}
      {item('pull', pulling ? 'Pulling…' : 'Pull (fast-forward)', pullReason, pulling)}
      <DropdownMenuSeparator />
      {management ? item('rename', 'Rename…', mutateReason) : null}
      {management ? item('delete', 'Delete…', branch.current ? 'Cannot delete the current branch' : mutateReason) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { if (navigator.clipboard) void navigator.clipboard.writeText(branch.name); }} style={{ fontSize: 11, paddingTop: 6, paddingBottom: 6 }}>
        <Copy size={12} />Copy name
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
