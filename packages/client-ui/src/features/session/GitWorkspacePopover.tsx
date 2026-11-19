import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, GitBranch, Loader2, RefreshCw, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import { chip } from './composer-parts.tsx';

export type WorkspaceChoice =
  | { kind: 'current' }
  | { kind: 'branch'; branch: string }
  | { kind: 'worktree'; branch: string; name?: string; includeDirty?: boolean; skipInclude?: boolean; skipSetup?: boolean }
  | { kind: 'existing'; path: string };
export type WorkspaceMode = 'local' | 'branch' | 'worktree';
export interface BranchInfo {
  name: string; subject: string; ts: number; sha?: string; upstream?: string | null;
  ahead?: number; behind?: number; current?: boolean; gone?: boolean;
}
export interface RepoInfo {
  current: string | null; detached: boolean; dirty: number; busyBranches: string[];
  local: BranchInfo[]; remote: BranchInfo[]; defaultBranch: string | null;
  hasWorktreeInclude: boolean; hasSetup: boolean; fetchedAt: number | null;
  worktrees: { path: string; branch: string | null; session: string | null; state: string | null; dirty: number }[];
}

const fieldStyle = {
  height: 26, width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-main)',
  color: 'var(--text-title)', font: 'inherit', fontSize: 11, padding: '0 7px',
};
const quiet: CSSProperties = { color: 'var(--text-hint)', fontSize: 11 };
const mutedButton: CSSProperties = {
  border: 0, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 3,
};
const terminalStates = new Set(['done', 'failed', 'archived']);

function shortAge(ts: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function folderName(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path; }
function shortPath(path: string, root: string) {
  const normalized = path.replace(/\\/g, '/');
  const prefix = `${root.replace(/\\/g, '/').replace(/\/$/, '')}/`;
  return normalized.startsWith(prefix) ? `…/${normalized.slice(prefix.length)}` : normalized;
}

export function branchNameIssue(name: string, info: RepoInfo): string | undefined {
  const value = name;
  if (!value || value.trim() !== value || /[\s~^:?*\[\]\\]/.test(value) || value.includes('..') || value.includes('@{')
    || value.includes('//') || value.startsWith('/') || value.startsWith('.') || value.endsWith('/') || value.endsWith('.')
    || value.split('/').some(part => part.endsWith('.lock'))) return 'Invalid name';
  if (info.local.some(branch => branch.name === value)) return 'Already exists';
  return undefined;
}

type BaseOption = {
  group: string; name: string; subject: string; ts: number;
  ahead?: number; behind?: number; upstream?: string | null; hint?: string;
};

export function GitChip({ value, onChange, info, project, mode, onModeChange, branchName, onBranchNameChange, title, onOpen, onFetch }: {
  value: WorkspaceChoice; onChange: (workspace: WorkspaceChoice) => void; info: RepoInfo; project: string;
  mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void;
  branchName: string; onBranchNameChange: (name: string) => void;
  title?: string; onOpen?: () => void; onFetch: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [baseSearch, setBaseSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [worktreesExpanded, setWorktreesExpanded] = useState(info.worktrees.length <= 3);
  useEffect(() => {
    setBaseSearch('');
    setWorktreesExpanded(info.worktrees.length <= 3);
  }, [project]);

  const currentBusy = Boolean(info.current && info.busyBranches.includes(info.current));
  const selectedExisting = value.kind === 'existing' ? info.worktrees.find(worktree => worktree.path === value.path) : undefined;
  const base = value.kind === 'worktree' ? value.branch : info.defaultBranch ?? info.current ?? info.local[0]?.name ?? '';
  const dirtyIncluded = value.kind === 'worktree' && value.branch === base && Boolean(value.includeDirty);
  const copyIncluded = value.kind === 'worktree' ? !value.skipInclude : true;
  const setupIncluded = value.kind === 'worktree' ? !value.skipSetup : true;
  const nameIssue = branchNameIssue(branchName, info);
  const currentInfo = info.local.find(branch => branch.name === info.current);
  const statusParts = [
    info.current ?? 'detached',
    currentInfo?.upstream ? `${currentInfo.ahead ? `↑${currentInfo.ahead} ` : ''}${currentInfo.behind ? `↓${currentInfo.behind} ` : ''}vs ${currentInfo.upstream}` : '',
    info.dirty ? `${info.dirty} changed` : '',
  ].filter(Boolean);
  const repoLabel = folderName(project);
  const label: ReactNode = value.kind === 'existing' ? `in ${selectedExisting?.branch ?? 'worktree'}`
    : value.kind === 'branch' ? `+ ${branchName}`
      : value.kind === 'worktree' ? <>
        <span className="truncate" style={{ maxWidth: 112 }}>{branchName}</span>
        <span style={{ flexShrink: 0 }}>←</span>
        <span className="truncate" style={{ maxWidth: 82 }}>{value.branch}</span>
      </> : info.detached ? 'detached' : info.current ?? 'current';
  const amber = info.detached || currentBusy;

  const worktreeChoice = (nextBase = base, includeDirty = dirtyIncluded, options?: { copy?: boolean; setup?: boolean }) => onChange({
    kind: 'worktree', branch: nextBase, name: branchName.trim(),
    ...(includeDirty && nextBase === info.current ? { includeDirty: true } : {}),
    ...(info.hasWorktreeInclude && !(options?.copy ?? copyIncluded) ? { skipInclude: true } : {}),
    ...(info.hasSetup && !(options?.setup ?? setupIncluded) ? { skipSetup: true } : {}),
  });
  const chooseMode = (next: WorkspaceMode) => {
    if (next === 'local' && (info.detached || currentBusy)) return;
    if (next === 'branch' && currentBusy) return;
    onModeChange(next);
  };
  const fetch = async () => {
    setFetching(true);
    try { await onFetch(); } finally { setFetching(false); }
  };

  const options = useMemo(() => {
    const query = baseSearch.trim().toLocaleLowerCase();
    const rows: BaseOption[] = [];
    const add = (group: string, branch: BranchInfo | undefined, name: string, hint?: string) => {
      const item = branch ?? { name, subject: '', ts: 0 };
      if (!query || `${name} ${item.subject} ${hint ?? ''} ${item.upstream ?? ''}`.toLocaleLowerCase().includes(query))
      rows.push({
        group, name, subject: item.subject, ts: item.ts,
        ...(item.ahead !== undefined ? { ahead: item.ahead } : {}),
        ...(item.behind !== undefined ? { behind: item.behind } : {}),
        ...(item.upstream !== undefined ? { upstream: item.upstream } : {}),
        ...(hint ? { hint } : {}),
      });
    };
    const seen = new Set<string>();
    if (info.defaultBranch) {
      add('Suggested', info.remote.find(branch => branch.name === info.defaultBranch)
        ?? info.local.find(branch => branch.name === info.defaultBranch), info.defaultBranch,
        `latest remote · fetches first${info.defaultBranch === info.current ? ' · current' : ''}`);
      seen.add(info.defaultBranch);
    }
    if (info.current) {
      if (!seen.has(info.current)) add('Suggested', info.local.find(branch => branch.name === info.current), info.current, 'current');
      seen.add(info.current);
    }
    for (const branch of info.local) if (!seen.has(branch.name)) add('Local', branch, branch.name);
    for (const branch of info.remote) if (!seen.has(branch.name)) add('Remote', branch, branch.name);
    return rows.slice(0, 100);
  }, [baseSearch, info]);
  const allOptionCount = info.local.length + info.remote.length
    + Number(Boolean(info.defaultBranch)) + Number(Boolean(info.current && info.current !== info.defaultBranch));
  const truncated = allOptionCount > options.length && options.length === 100;
  const chooseBase = (name: string) => {
    setBaseSearch('');
    setActiveIndex(0);
    worktreeChoice(name, name === info.current && dirtyIncluded);
  };
  const onBaseKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!options.length) return;
      setActiveIndex(index => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      setActiveIndex(index => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && options[activeIndex]) {
      event.preventDefault();
      chooseBase(options[activeIndex]!.name);
    }
  };
  const remoteBase = info.remote.some(branch => branch.name === base);
  const branchInput = (
    <div>
      <label style={{ display: 'block', ...quiet, marginBottom: 5 }}>Branch name</label>
      <input aria-label="Branch name" value={branchName} onChange={event => onBranchNameChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        style={{ ...fieldStyle, borderColor: nameIssue ? 'var(--accent-red)' : 'var(--line-card)' }} />
      <div style={{ ...quiet, color: nameIssue ? 'var(--accent-red)' : 'var(--text-hint)', minHeight: 16, marginTop: 4 }}>
        {nameIssue ?? (mode === 'branch'
          ? `Branches from ${info.current ?? 'the current commit'}, uncommitted changes come along`
          : `Worktree from ${base || 'the selected base'}${base === info.current && info.dirty ? ' · uncommitted changes stay in the main checkout unless included' : ''}`)}
      </div>
    </div>
  );
  const optionsSummary = [
    remoteBase ? 'fetches first' : '',
    info.hasWorktreeInclude && copyIncluded ? 'copies ignored files' : '',
    info.hasSetup && setupIncluded ? 'runs setup' : '',
    dirtyIncluded ? 'includes uncommitted changes' : info.dirty ? 'changes stay in the main checkout' : '',
  ].filter(Boolean);
  const summary = value.kind === 'existing'
    ? `Use existing worktree ${selectedExisting?.branch ?? 'worktree'}`
    : mode === 'local' ? `Work directly in the main checkout on ${info.current ?? 'detached HEAD'}`
      : mode === 'branch' ? `New branch ${branchName} from ${info.current ?? 'the current commit'}${info.dirty ? ' · uncommitted changes come along' : ''}`
        : `New worktree ${branchName} from ${base || 'the selected base'}${optionsSummary.length ? ` · ${optionsSummary.join(' · ')}` : ''}`;
  const fetchedTitle = info.fetchedAt ? `Fetched ${shortAge(info.fetchedAt)} ago` : 'Never fetched';
  const worktreeBusy = (worktree: RepoInfo['worktrees'][number]) =>
    Boolean(worktree.session && !terminalStates.has(worktree.state ?? ''));

  return (
    <Popover.Root open={open} onOpenChange={next => {
      setOpen(next);
      if (next) {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
          const below = window.innerHeight - rect.bottom - 8;
          const above = rect.top - 8;
          setSide(below > above ? 'bottom' : 'top');
          setWorktreesExpanded(info.worktrees.length <= 3 && Math.max(below, above) >= 560);
        }
        setBaseSearch('');
        setActiveIndex(0);
        onOpen?.();
      }
    }}>
      <Popover.Trigger asChild>
        <button ref={triggerRef} className="hv-sub" style={{ ...chip, maxWidth: 245, minWidth: 0 }} title={title}>
          <GitBranch size={12} style={{ color: amber ? 'var(--accent-amber)' : 'var(--text-hint)', flexShrink: 0 }} />
          {amber || (value.kind === 'current' && info.dirty > 0) ? <span style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: amber ? 'var(--accent-amber)' : 'var(--text-hint)',
          }} /> : null}
          <span className="ormi-chip-text" style={{
            display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden',
            fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 0,
          }}>{label}</span>
          <ChevronDown size={11} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={side} align="end" sideOffset={6} collisionPadding={8} avoidCollisions
          onEscapeKeyDown={() => setOpen(false)}
          style={{
            zIndex: 80, width: 380, maxWidth: 'calc(100vw - 16px)',
            maxHeight: 'min(560px, var(--radix-popover-content-available-height))',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxSizing: 'border-box', padding: 12,
            background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 10,
            color: 'var(--text-active)', fontSize: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,.24)', outline: 'none',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: 'var(--text-title)', fontWeight: 600, fontSize: 13 }} className="truncate">{repoLabel}</div>
              <div style={{ ...quiet, fontSize: 10 }} className="truncate">{statusParts.join(' · ')}</div>
            </div>
            <button type="button" aria-label="Fetch branches" title={`${fetchedTitle} · Fetch from remotes`}
              disabled={fetching} onClick={() => void fetch()} style={mutedButton}>
              {fetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
          <div role="group" aria-label="Workspace mode" style={{
            height: 28, boxSizing: 'border-box', display: 'flex', gap: 2, padding: 2,
            borderRadius: 7, background: 'var(--bg-chip)', flexShrink: 0,
          }}>
            {([
              ['local', 'Local', info.detached || currentBusy, info.detached ? 'HEAD is detached — choose a new branch or worktree' : currentBusy ? `${info.current} is in use by another session` : undefined],
              ['branch', 'New branch', currentBusy, currentBusy ? `${info.current} is in use by another session` : undefined],
              ['worktree', 'Worktree', false, undefined],
            ] as [WorkspaceMode, string, boolean, string | undefined][]).map(([key, text, disabled, reason]) => (
              <span key={key} title={reason} style={{ flex: 1, minWidth: 0 }}>
                <button type="button" aria-pressed={mode === key} disabled={disabled} onClick={() => chooseMode(key)} style={{
                  width: '100%', height: '100%', minWidth: 0, border: 0, borderRadius: 5, padding: '0 5px',
                  background: mode === key ? 'var(--bg-raised)' : 'transparent',
                  color: mode === key ? 'var(--text-title)' : 'var(--text-hint)',
                  font: 'inherit', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}>{text}</button>
              </span>
            ))}
          </div>
          {currentBusy ? <div style={{ ...quiet, marginTop: 6, flexShrink: 0 }}>{info.current} is in use by another session — Worktree is selected</div> : null}
          <div style={{ paddingTop: 4, display: 'grid', gap: 4, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {mode === 'local' ? <div style={{ ...quiet, lineHeight: 1.5 }}>
              Work directly in the main checkout on <span style={{ color: 'var(--text-title)', fontFamily: 'var(--font-mono)' }}>{info.current}</span>
              {info.dirty ? <div style={{ marginTop: 5 }}>{info.dirty} uncommitted {info.dirty === 1 ? 'change' : 'changes'}</div> : null}
            </div> : null}
            {mode === 'branch' ? branchInput : null}
            {mode === 'worktree' ? <>
              {value.kind !== 'existing' ? <>
                <div>
                  <label htmlFor="ormi-git-base" style={{ display: 'block', ...quiet, marginBottom: 5 }}>Base</label>
                  <div style={{ position: 'relative' }}>
                    <Search size={12} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-hint)' }} />
                    <input id="ormi-git-base" role="combobox" aria-label="Base branch" aria-expanded="true" aria-controls="ormi-git-base-options"
                      aria-activedescendant={options[activeIndex] ? `ormi-git-base-${activeIndex}` : undefined}
                      value={baseSearch} onChange={event => { setBaseSearch(event.target.value); setActiveIndex(0); }}
                      onKeyDown={onBaseKeyDown} placeholder={base ? `Filter branches · ${base}` : 'Filter branches…'} style={{ ...fieldStyle, paddingLeft: 25 }} />
                  </div>
                  <div id="ormi-git-base-options" role="listbox" aria-label="Base branches" style={{
                    maxHeight: 'min(180px, max(72px, calc(var(--radix-popover-content-available-height) - 400px)))',
                    overflowY: 'auto', marginTop: 5, border: '1px solid var(--line-card)', borderRadius: 6, padding: 3,
                  }}>
                    {options.map((option, index) => {
                      const inUse = info.busyBranches.includes(option.name);
                      return <div key={`${option.group}:${option.name}`}>
                        {index === 0 || option.group !== options[index - 1]?.group ? <div style={{ ...quiet, fontSize: 10, padding: '5px 6px 3px' }}>{option.group}</div> : null}
                        <button id={`ormi-git-base-${index}`} type="button" role="option" aria-selected={base === option.name}
                          onMouseDown={event => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(index)} onClick={() => chooseBase(option.name)}
                          style={{
                            width: '100%', minHeight: 36, display: 'flex', alignItems: 'center', gap: 7,
                            border: 0, borderRadius: 4, padding: '4px 6px', textAlign: 'left',
                            color: 'var(--text-active)', background: activeIndex === index ? 'var(--bg-card)' : 'transparent',
                            font: 'inherit', cursor: 'pointer',
                          }}>
                          <span style={{ width: 14, flexShrink: 0, color: 'var(--text-title)' }}>{base === option.name ? <Check size={12} /> : null}</span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11.5 }} className="truncate">{option.name}</span>
                            <span style={{ display: 'block', ...quiet, fontSize: 10 }} className="truncate">
                              {[option.hint, option.subject, option.ts ? shortAge(option.ts) : ''].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {option.ahead || option.behind ? <span style={{ ...quiet, fontSize: 9, whiteSpace: 'nowrap' }}>
                            {option.ahead ? `↑${option.ahead} ` : ''}{option.behind ? `↓${option.behind} ` : ''}vs {option.upstream ?? ''}
                          </span> : null}
                          {inUse ? <span style={{ ...quiet, fontSize: 9, whiteSpace: 'nowrap' }}>in use</span> : null}
                        </button>
                      </div>;
                    })}
                    {!options.length ? <div style={{ ...quiet, padding: 8 }}>No matching branches</div> : null}
                    {truncated ? <div style={{ ...quiet, fontSize: 10, padding: 5 }}>100 shown — refine search</div> : null}
                  </div>
                </div>
                {branchInput}
                {info.dirty > 0 ? <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...quiet, cursor: base === info.current ? 'pointer' : 'not-allowed', opacity: base === info.current ? 1 : 0.5 }}>
                  <input className="ormi-check" type="checkbox" checked={dirtyIncluded} disabled={base !== info.current}
                    onChange={event => worktreeChoice(base, event.target.checked)} />
                  Include {info.dirty} uncommitted {info.dirty === 1 ? 'change' : 'changes'}
                </label> : null}
                {info.hasWorktreeInclude ? <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...quiet, cursor: 'pointer' }}>
                  <input className="ormi-check" type="checkbox" checked={copyIncluded}
                    onChange={event => worktreeChoice(base, dirtyIncluded, { copy: event.target.checked })} />
                  Copy ignored files listed in .worktreeinclude
                </label> : null}
                {info.hasSetup ? <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...quiet, cursor: 'pointer' }}>
                  <input className="ormi-check" type="checkbox" checked={setupIncluded}
                    onChange={event => worktreeChoice(base, dirtyIncluded, { setup: event.target.checked })} />
                  Run setup script (.ormi/setup)
                </label> : null}
              </> : null}
              <div style={{ borderTop: '1px solid var(--line-card)', paddingTop: 3 }}>
                <button type="button" onClick={() => setWorktreesExpanded(expanded => !expanded)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 7, border: 0,
                  background: 'transparent', color: 'var(--text-label)', font: 'inherit', fontSize: 11,
                  padding: '2px 0', cursor: 'pointer', textAlign: 'left',
                }}>
                  <ChevronDown size={12} style={{ transform: worktreesExpanded ? 'rotate(0)' : 'rotate(-90deg)', color: 'var(--text-hint)' }} />
                  Existing worktrees <span style={{ ...quiet, marginLeft: 'auto' }}>{info.worktrees.length}</span>
                </button>
                {worktreesExpanded ? <div style={{ display: 'grid', gap: 3, marginTop: 5 }}>
                  {info.worktrees.length ? info.worktrees.map(worktree => {
                    const busy = worktreeBusy(worktree);
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
                        onClick={() => onChange({ kind: 'existing', path: worktree.path })} style={{
                          ...mutedButton, fontSize: 10, borderRadius: 4, padding: '4px 7px',
                          background: 'var(--bg-raised)', opacity: busy ? 0.45 : 1, cursor: busy ? 'not-allowed' : 'pointer',
                        }}>Use</button>
                    </div>;
                  }) : <div style={{ ...quiet, padding: '5px 0' }}>No linked worktrees</div>}
                </div> : null}
              </div>
            </> : null}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            margin: '10px -12px -12px', padding: '9px 12px', background: 'var(--bg-raised)',
            borderTop: '1px solid var(--line-card)',
          }}>
            <span style={{
              ...quiet, fontSize: 10, minWidth: 0, flex: 1, lineHeight: 1.35,
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
              overflow: 'hidden', overflowWrap: 'normal', wordBreak: 'normal',
            }}>{summary}</span>
            <button type="button" onClick={() => setOpen(false)} style={{
              border: '1px solid var(--line-card)', borderRadius: 6, padding: '4px 10px',
              background: 'var(--bg-card)', color: 'var(--text-title)', font: 'inherit', fontSize: 11, cursor: 'pointer',
            }}>Done</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
