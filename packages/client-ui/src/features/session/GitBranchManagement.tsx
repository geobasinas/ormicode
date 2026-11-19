import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { BranchActionMenu, type BranchMenuAction } from './BranchActionMenu.tsx';
import { branchNameIssue, type BranchInfo, type RepoInfo } from './GitWorkspacePopover.tsx';
import { feedback } from '../../lib/feedback.ts';

type ProjectMethod = 'project.pull' | 'project.renameBranch' | 'project.deleteBranch';
type ActionResult = { updated?: boolean; from?: string; to?: string };
type BranchRow = BranchInfo & { remote: boolean };
const quiet = { color: 'var(--text-hint)', fontSize: 10 };
const inputStyle = {
  height: 26, width: '100%', minWidth: 0, boxSizing: 'border-box' as const, outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-main)',
  color: 'var(--text-title)', font: 'inherit', fontSize: 11, padding: '0 7px',
};

function age(ts: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}
function tags(branch: BranchRow, info: RepoInfo) {
  return [
    branch.current ? 'current' : '',
    info.busyBranches.includes(branch.name) ? 'in use' : '',
    branch.worktreePath ? 'worktree' : '',
    branch.merged ? 'merged' : '',
    branch.gone ? 'gone' : '',
  ].filter(Boolean);
}

export function GitBranchManagement({ info, project, onProjectAction, onSelect }: {
  info: RepoInfo; project: string;
  onProjectAction: (method: ProjectMethod, body: Record<string, unknown>) => Promise<ActionResult>;
  onSelect: (kind: 'checkout' | 'branch' | 'worktree', branch: BranchInfo) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'local' | 'remote' | 'merged' | 'stale'>('all');
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState<string>();
  const [results, setResults] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string>();
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteForce, setDeleteForce] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupNames, setCleanupNames] = useState<string[]>([]);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  const rows = useMemo(() => {
    const local = info.local.map(branch => ({ ...branch, remote: false }));
    const remote = info.remote.map(branch => ({ ...branch, remote: true }));
    let all: BranchRow[] = filter === 'local' ? local : filter === 'remote' ? remote
      : filter === 'merged' ? local.filter(branch => branch.merged)
        : filter === 'stale' ? local.filter(branch => branch.gone) : [...local, ...remote];
    const needle = query.trim().toLocaleLowerCase();
    if (needle) all = all.filter(branch => `${branch.name} ${branch.subject} ${branch.upstream ?? ''}`.toLocaleLowerCase().includes(needle));
    return all;
  }, [filter, info.local, info.remote, query]);
  const cleanupBranches = info.local.filter(branch =>
    branch.merged && !branch.current && !info.busyBranches.includes(branch.name) && !branch.worktreePath);
  const cleanupRows = [...new Set([...cleanupBranches.map(branch => branch.name), ...cleanupNames])];
  const renameIssue = editing ? branchNameIssue(renameName, info, editing) : undefined;

  const handleAction = (action: BranchMenuAction, branch: BranchInfo) => {
    if (action === 'start') onSelect('checkout', branch);
    else if (action === 'branch') onSelect('branch', branch);
    else if (action === 'worktree') onSelect('worktree', branch);
    else if (action === 'pull') void pull(branch);
    else if (action === 'rename') {
      setEditing(branch.name); setRenameName(branch.name); setRenameError('');
    } else if (action === 'delete') {
      setDeleting(branch.name); setDeleteConfirm(''); setDeleteForce(false); setDeleteError('');
    }
  };
  const pull = async (branch: BranchInfo) => {
    setPulling(branch.name);
    setResults(current => ({ ...current, [branch.name]: '' }));
    try {
      const response = await onProjectAction('project.pull', { project, branch: branch.name });
      const count = branch.behind || (response.updated ? 1 : 0);
      setResults(current => ({ ...current, [branch.name]: response.updated
        ? `Updated ${count} commit${count === 1 ? '' : 's'}` : 'Already up to date' }));
      feedback.success(response.updated ? `Pulled ${branch.name}` : `${branch.name} is up to date`);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setResults(current => ({ ...current, [branch.name]: message })); feedback.error(message); }
    finally { setPulling(undefined); }
  };
  const saveRename = async () => {
    if (!editing || renameIssue) return;
    try {
      await onProjectAction('project.renameBranch', { project, from: editing, to: renameName });
      setResults(current => ({ ...current, [editing]: `Renamed to ${renameName}` }));
      feedback.success(`Branch renamed to ${renameName}`);
      setEditing(undefined);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setRenameError(message); feedback.error(message); }
  };
  const saveDelete = async () => {
    if (!deleting || deleteConfirm !== deleting || (!deleteForce && !info.local.find(branch => branch.name === deleting)?.merged)) return;
    try {
      await onProjectAction('project.deleteBranch', { project, name: deleting, confirm: deleteConfirm, ...(deleteForce ? { force: true } : {}) });
      setResults(current => ({ ...current, [deleting]: 'Deleted' }));
      feedback.success(`Deleted branch ${deleting}`);
      setDeleting(undefined);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setDeleteError(message); feedback.error(message); }
  };
  const toggleCleanup = () => {
    if (!cleanupOpen) setCleanupNames(cleanupBranches.map(branch => branch.name));
    setCleanupOpen(open => !open);
  };
  const cleanUp = async () => {
    setCleanupRunning(true);
    let deleted = 0;
    let firstError = '';
    for (const name of cleanupNames) {
      try {
        await onProjectAction('project.deleteBranch', { project, name, confirm: name });
        setResults(current => ({ ...current, [name]: 'Deleted' }));
        deleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        firstError ||= message;
        setResults(current => ({ ...current, [name]: `Failed: ${message}` }));
      }
    }
    setCleanupRunning(false);
    if (deleted) feedback.success(`Cleaned up ${deleted} branch${deleted === 1 ? '' : 'es'}`);
    if (firstError) feedback.error(firstError);
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 0 }}>
    <div style={{ display: 'flex', gap: 4 }}>
      {(['all', 'local', 'remote', 'merged', 'stale'] as const).map(item => (
        <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} style={{
          border: '1px solid var(--line-card)', borderRadius: 12, padding: '3px 7px',
          background: filter === item ? 'var(--bg-card)' : 'transparent',
          color: filter === item ? 'var(--text-title)' : 'var(--text-hint)', font: 'inherit', fontSize: 10, cursor: 'pointer',
        }}>{item === 'stale' ? 'Stale' : `${item[0]!.toUpperCase()}${item.slice(1)}`}</button>
      ))}
    </div>
    <div style={{ position: 'relative' }}>
      <Search size={12} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-hint)' }} />
      <input aria-label="Search branches" placeholder="Search branches…" value={query} onChange={event => setQuery(event.target.value)}
        style={{ ...inputStyle, paddingLeft: 25 }} />
    </div>
    {cleanupOpen ? <div style={{ display: 'grid', gap: 3, maxHeight: 250, overflowY: 'auto', border: '1px solid var(--line-card)', borderRadius: 6, padding: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', ...quiet, marginBottom: 3 }}>
        <span>Clean up merged branches</span>
        <button type="button" onClick={() => setCleanupOpen(false)} aria-label="Close cleanup list" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer' }}><X size={12} /></button>
      </div>
      {cleanupRows.map(name => <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 24, ...quiet }}>
        <input className="ormi-check" type="checkbox" checked={cleanupNames.includes(name)} disabled={!cleanupBranches.some(branch => branch.name === name)}
          onChange={event => setCleanupNames(names => event.target.checked ? [...names, name] : names.filter(item => item !== name))} />
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-title)' }}>{name}</span>
        {results[name] ? <span style={{ marginLeft: 'auto' }}>{results[name]}</span> : null}
      </label>)}
      {!cleanupRows.length ? <span style={quiet}>No eligible merged branches</span> : null}
      <button type="button" disabled={!cleanupNames.length || cleanupRunning || cleanupNames.every(name => Boolean(results[name]))} onClick={() => void cleanUp()} style={{
        height: 26, border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-card)',
        color: 'var(--text-title)', font: 'inherit', fontSize: 10, cursor: 'pointer',
      }}>{cleanupRunning ? 'Deleting…' : `Delete ${cleanupNames.length} branches`}</button>
    </div> : <div style={{ display: 'grid', gap: 2 }}>
      {rows.map(branch => {
        const branchTags = tags(branch, info);
        return <div key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`}>
          <div style={{
            minHeight: 30, display: 'flex', alignItems: 'center', gap: 5, borderRadius: 5,
            padding: '2px 3px 2px 6px', background: 'var(--bg-card)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span className="truncate" style={{ minWidth: 0, color: 'var(--text-title)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{branch.name}</span>
                {branchTags.map(tag => <span key={tag} style={{
                  color: tag === 'gone' ? 'var(--accent-amber)' : 'var(--text-hint)', fontSize: 8.5, whiteSpace: 'nowrap',
                }}>{tag}</span>)}
              </div>
              <div className="truncate" style={{ ...quiet, fontSize: 9, lineHeight: '11px' }}>
                {[branch.subject, age(branch.ts), branch.ahead ? `↑${branch.ahead}` : '', branch.behind ? `↓${branch.behind}` : ''].filter(Boolean).join(' · ')}
              </div>
              {results[branch.name] ? <div className="truncate" style={{
                color: /failed|git\./i.test(results[branch.name]!) ? 'var(--accent-red)' : 'var(--text-hint)', fontSize: 9,
              }}>{results[branch.name]}</div> : null}
            </div>
            {pulling === branch.name ? <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-hint)' }} /> : null}
            <BranchActionMenu branch={branch} info={info} onAction={handleAction} pulling={pulling === branch.name} />
          </div>
          {editing === branch.name ? <div style={{ display: 'grid', gap: 5, border: '1px solid var(--line-card)', borderRadius: 6, padding: 7, marginTop: 3 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <input autoFocus aria-label={`Rename ${editing}`} value={renameName} onChange={event => { setRenameName(event.target.value); setRenameError(''); }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
                  if (event.key === 'Escape') { event.stopPropagation(); setEditing(undefined); }
                }}
                style={{ ...inputStyle, borderColor: renameIssue ? 'var(--accent-red)' : 'var(--line-card)' }} />
              <button type="button" disabled={Boolean(renameIssue)} onClick={() => void saveRename()} style={{ ...buttonStyle }}>Save</button>
              <button type="button" onClick={() => setEditing(undefined)} style={{ ...buttonStyle }}>Esc</button>
            </div>
            <div style={{ ...quiet, color: renameError || renameIssue ? 'var(--accent-red)' : 'var(--text-hint)' }}>{renameError || renameIssue || 'Enter a valid branch name'}</div>
          </div> : null}
          {deleting === branch.name ? <div style={{ display: 'grid', gap: 5, border: '1px solid var(--line-card)', borderRadius: 6, padding: 7, marginTop: 3 }}>
            <div style={{ ...quiet }}>Type <span style={{ color: 'var(--text-title)', fontFamily: 'var(--font-mono)' }}>{deleting}</span> to delete</div>
            <input autoFocus aria-label={`Confirm deletion of ${deleting}`} value={deleteConfirm} onChange={event => { setDeleteConfirm(event.target.value); setDeleteError(''); }}
              onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDeleting(undefined); } }}
              style={inputStyle} />
            {!info.local.find(item => item.name === deleting)?.merged ? <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-red)', fontSize: 10 }}>
              <input className="ormi-check" type="checkbox" checked={deleteForce} onChange={event => setDeleteForce(event.target.checked)} />
              Not merged — delete anyway
            </label> : null}
            {deleteError ? <div style={{ ...quiet, color: 'var(--accent-red)' }}>{deleteError}</div> : null}
            <button type="button" disabled={deleteConfirm !== deleting || (!deleteForce && !info.local.find(item => item.name === deleting)?.merged)}
              onClick={() => void saveDelete()} style={{ ...buttonStyle, color: 'var(--accent-red)' }}>Delete branch</button>
          </div> : null}
        </div>;
      })}
      {!rows.length ? <div style={{ ...quiet, padding: 12, textAlign: 'center' }}>No matching branches</div> : null}
    </div>}
    {!cleanupOpen ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--line-card)', paddingTop: 6 }}>
      <button type="button" onClick={toggleCleanup} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-hint)', font: 'inherit', fontSize: 10, cursor: 'pointer' }}>
        <ChevronDown size={11} style={{ display: 'inline', transform: cleanupOpen ? 'rotate(180deg)' : undefined }} /> Clean up merged ({cleanupBranches.length})
      </button>
    </div> : null}
  </div>;
}

const buttonStyle = {
  height: 26, flexShrink: 0, border: '1px solid var(--line-card)', borderRadius: 5,
  background: 'var(--bg-card)', color: 'var(--text-title)', font: 'inherit', fontSize: 10,
  padding: '0 7px', cursor: 'pointer',
};
