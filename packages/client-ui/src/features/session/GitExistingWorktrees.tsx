import { ChevronDown } from 'lucide-react';
import type { RepoInfo } from './GitWorkspacePopover.tsx';

const terminalStates = new Set(['done', 'failed', 'archived']);
const quiet = { color: 'var(--text-hint)', fontSize: 11 };
const mutedButton = {
  border: 0, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 3,
};

function shortPath(path: string, root: string) {
  const normalized = path.replace(/\\/g, '/');
  const prefix = `${root.replace(/\\/g, '/').replace(/\/$/, '')}/`;
  return normalized.startsWith(prefix) ? `…/${normalized.slice(prefix.length)}` : normalized;
}

export function GitExistingWorktrees({ info, project, expanded, onToggle, onUse }: {
  info: RepoInfo; project: string; expanded: boolean; onToggle: () => void; onUse: (path: string) => void;
}) {
  return <div style={{ borderTop: '1px solid var(--line-card)', paddingTop: 3 }}>
    <button type="button" onClick={onToggle} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 7, border: 0,
      background: 'transparent', color: 'var(--text-label)', font: 'inherit', fontSize: 11,
      padding: '2px 0', cursor: 'pointer', textAlign: 'left',
    }}>
      <ChevronDown size={12} style={{ transform: expanded ? 'rotate(0)' : 'rotate(-90deg)', color: 'var(--text-hint)' }} />
      Existing worktrees <span style={{ ...quiet, marginLeft: 'auto' }}>{info.worktrees.length}</span>
    </button>
    {expanded ? <div style={{ display: 'grid', gap: 3, marginTop: 5 }}>
      {info.worktrees.length ? info.worktrees.map(worktree => {
        const busy = Boolean(worktree.session && !terminalStates.has(worktree.state ?? ''));
        return <div key={worktree.path} style={{
          minHeight: 38, display: 'flex', alignItems: 'center', gap: 7,
          borderRadius: 5, padding: '4px 5px', background: 'var(--bg-card)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: 'var(--text-title)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }} className="truncate">{worktree.branch ?? 'detached'}</div>
            <div style={{ ...quiet, fontSize: 9.5 }} className="truncate">
              {shortPath(worktree.path, project)} · {worktree.session ? worktree.state ?? 'session' : 'free'}{busy ? ' · in use' : ''} · {worktree.dirty} changed
            </div>
          </div>
          <button type="button" disabled={busy} title={busy ? 'This worktree is in use by another session' : 'Use this worktree'}
            onClick={() => onUse(worktree.path)} style={{
              ...mutedButton, fontSize: 10, borderRadius: 4, padding: '4px 7px',
              background: 'var(--bg-raised)', color: busy ? 'var(--text-hint)' : 'var(--text-secondary)', cursor: busy ? 'not-allowed' : 'pointer',
            }}>Use</button>
        </div>;
      }) : <div style={{ ...quiet, padding: '5px 0' }}>No linked worktrees</div>}
    </div> : null}
  </div>;
}
