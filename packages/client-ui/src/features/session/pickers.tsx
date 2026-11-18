/** Composer mega-chips for new sessions: one chip bundling agent + transport +
 * model + effort (nested submenus), and one chip for the git workspace choice
 * (current branch / new branch / worktree from a branch). */
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Cpu, Gauge, GitBranch, Loader2, Pencil, RefreshCw, Search } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { chip } from './composer-parts.tsx';
import { VendorIcon, vendorColor } from './vendor-icons.tsx';
import type { ListedModel } from './useModels.ts';

const chev = <ChevronDown size={11} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />;
const mark = (on: boolean) => <span style={{ width: 16, display: 'inline-flex' }}>{on ? <Check size={13} /> : null}</span>;
const right = (text: string) => <span style={{ marginLeft: 'auto', paddingLeft: 16, color: 'var(--text-hint)', fontSize: 10 }} className="truncate">{text}</span>;

const VENDOR_META: Record<string, { name: string }> = {
  claude: { name: 'Claude' }, codex: { name: 'Codex' }, grok: { name: 'Grok' },
  opencode: { name: 'OpenCode' }, pi: { name: 'Pi' }, vibe: { name: 'Vibe' }, fake: { name: 'Fake' },
};
const TRANSPORT_DESC: Record<string, string> = { sdk: 'in-process', cli: 'command line', acp: 'agent protocol' };
const meta = (vendor: string) => VENDOR_META[vendor] ?? { name: vendor };

/** Brand mark on a tinted tile. */
const tile = (vendor: string) => (
  <span style={{
    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
    background: `color-mix(in srgb, ${vendorColor(vendor)} 15%, transparent)`,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }}><VendorIcon vendor={vendor} /></span>
);

/** Effort levels a model advertises; falls back to a shared set when every
 * model lists the same levels (used when the model id is custom). */
function effortChoices(model: string, models: ListedModel[]): string[] {
  const selected = models.find(m => m.id === model);
  if (selected) return selected.efforts;
  const sets = models.map(m => [...m.efforts].sort().join('\0'));
  return sets.length && new Set(sets).size === 1 ? models[0]!.efforts : [];
}

/** One chip for everything about the worker: agent + transport in the top
 * section, model and effort behind ▸ submenus. */
export function AgentChip({ vendor, via, agents, onPick, model, models, onModel, effort, onEffort, loading, refresh, icon, title }: {
  vendor: string; via: string; agents: { vendor: string; transports: string[] }[];
  onPick: (vendor: string, transport: string) => void;
  model: string; models: ListedModel[]; onModel: (id: string) => void;
  effort: string; onEffort: (v: string) => void;
  loading: boolean; refresh: () => Promise<unknown>; icon?: ReactNode; title?: string;
}) {
  const [query, setQuery] = useState('');
  const list = models.filter(m => m.id !== 'default');
  const current = list.find(m => m.id === model);
  const matching = list.filter(m => `${m.label}\n${m.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = matching.slice(0, 200);
  const efforts = effortChoices(model, models);
  const pair = agents.find(a => a.vendor === vendor)?.transports.length === 1 ? vendor : `${vendor} ${via}`;
  return (
    <DropdownMenu onOpenChange={open => { if (!open) setQuery(''); }}>
      <DropdownMenuTrigger asChild>
        <button className="hv-sub" style={chip} title={title}>
          {icon ?? <VendorIcon vendor={vendor} size={11} />}
          <span className="ormi-chip-text">
            {pair}
            {model !== 'default' ? ` · ${current?.label ?? model}` : ''}
            {effort !== 'default' ? ` · ${effort}` : ''}
          </span>{chev}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" style={{ width: 248, maxWidth: 'calc(100vw - 16px)' }}>
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        {agents.map(a => a.transports.length === 1 ? (
          <DropdownMenuItem key={a.vendor} onSelect={() => onPick(a.vendor, a.transports[0]!)} className="text-xs" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {mark(a.vendor === vendor)}
            {tile(a.vendor)}
            <span className="min-w-0 flex-1 truncate">{meta(a.vendor).name}</span>
            {right(a.transports[0]!)}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={a.vendor}>
            <DropdownMenuSubTrigger className="text-xs" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {mark(a.vendor === vendor)}
              {tile(a.vendor)}
              <span className="min-w-0 flex-1 truncate">{meta(a.vendor).name}</span>
              {a.vendor === vendor ? right(via) : right(a.transports.join(' · '))}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent style={{ minWidth: 180 }}>
              <DropdownMenuLabel>{meta(a.vendor).name}</DropdownMenuLabel>
              {a.transports.map(t => (
                <DropdownMenuItem key={t} onSelect={() => onPick(a.vendor, t)} className="text-xs">
                  {mark(a.vendor === vendor && t === via)}
                  <span>{t.toUpperCase()}</span>
                  {right(TRANSPORT_DESC[t] ?? t)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <span style={{ width: 16 }} /><Cpu size={13} style={{ color: 'var(--text-hint)' }} /><span>Model</span>{right(current?.label ?? model)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent style={{ width: 300, maxWidth: 'calc(100vw - 16px)', maxHeight: 420 }}>
            {list.length > 10 ? (
              <div style={{ padding: '2px 8px 8px' }}>
                <input autoFocus aria-label="Search models" placeholder="Search models…" value={query}
                  onChange={e => setQuery(e.target.value)} onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                  style={{
                    width: '100%', height: 28, boxSizing: 'border-box', padding: '0 8px',
                    font: 'inherit', fontSize: 11, color: 'var(--text-title)', background: 'var(--bg-inset)',
                    border: '1px solid var(--line-card)', borderRadius: 6, outline: 'none',
                  }} />
              </div>
            ) : null}
            <DropdownMenuItem onSelect={() => onModel('default')} className="text-xs">{mark(model === 'default')}<span>Default</span></DropdownMenuItem>
            {loading ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>Loading models…</div>
              : !list.length ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>This agent doesn&apos;t list models</div> : null}
            {!loading && list.length ? visible.map(m => (
              <DropdownMenuItem key={m.id} disabled={!m.available} title={!m.available ? m.reason : undefined} onSelect={() => onModel(m.id)} className="text-xs">
                {mark(model === m.id)}
                {tile(m.agent)}
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                {m.label !== m.id ? <span style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{m.id}</span> : null}
              </DropdownMenuItem>
            )) : null}
            {!loading && list.length && !matching.length ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11 }}>No matching models</div> : null}
            {matching.length > visible.length ? <div style={{ padding: '5px 10px', color: 'var(--text-hint)', fontSize: 10 }}>Showing 200 of {matching.length} — refine search</div> : null}
            {query.trim() ? <DropdownMenuItem onSelect={() => onModel(query.trim())} className="text-xs"><span style={{ width: 16 }} />Use “{query.trim()}”</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={e => { e.preventDefault(); void refresh(); }} className="text-xs"><RefreshCw size={12} />Refresh list</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <span style={{ width: 16 }} /><Gauge size={13} style={{ color: 'var(--text-hint)' }} /><span>Effort</span>{right(effort)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {['default', ...efforts].map(c => (
              <DropdownMenuItem key={c} onSelect={() => onEffort(c)} className="text-xs">{mark(effort === c)}<span>{c === 'default' ? 'Default' : c}</span></DropdownMenuItem>
            ))}
            {!efforts.length ? <div style={{ padding: '8px 10px', color: 'var(--text-hint)', fontSize: 11, maxWidth: 220 }}>This model advertises no effort levels — “default” passes through.</div> : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type WorkspaceChoice =
  | { kind: 'current' }
  | { kind: 'branch'; branch: string }
  | { kind: 'worktree'; branch: string; name?: string; includeDirty?: boolean }
  | { kind: 'existing'; path: string };
export type WorkspaceMode = 'local' | 'worktree';
export interface RepoInfo {
  current: string | null; detached: boolean; dirty: number; busyBranches: string[];
  local: { name: string; subject: string; ts: number; current: boolean }[];
  remote: { name: string; subject: string; ts: number }[];
  defaultBranch: string | null;
  worktrees: { path: string; branch: string | null; session: string | null; state: string | null }[];
}

const fieldStyle = {
  height: 26, width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-main)',
  color: 'var(--text-title)', font: 'inherit', fontSize: 11, padding: '0 7px',
};

/** Local/worktree segmented control and branch-base picker for Git projects. */
export function GitChip({ value, onChange, info, mode, onModeChange, branchName, onBranchNameChange, icon, title, onOpen, onFetch }: {
  value: WorkspaceChoice; onChange: (w: WorkspaceChoice) => void; info: RepoInfo;
  mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void;
  branchName: string; onBranchNameChange: (name: string) => void;
  icon?: ReactNode; title?: string; onOpen?: () => void; onFetch: () => Promise<unknown>;
}) {
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentBusy = Boolean(info.current && info.busyBranches.includes(info.current));
  const selectedExisting = value.kind === 'existing' ? info.worktrees.find(item => item.path === value.path) : undefined;
  const label = value.kind === 'existing' ? `in ${selectedExisting?.branch ?? 'worktree'}`
    : mode === 'local' ? value.kind === 'branch' ? `new · ${value.branch}` : info.detached ? 'detached' : info.current ?? 'current'
      : `from ${value.kind === 'worktree' ? value.branch : (info.defaultBranch ?? info.current ?? 'branch')}`;
  const search = query.trim().toLocaleLowerCase();
  const matches = (text: string) => !search || text.toLocaleLowerCase().includes(search);
  const local = [...info.local]
    .sort((a, b) => Number(b.current) - Number(a.current) || b.ts - a.ts || a.name.localeCompare(b.name))
    .filter(b => matches(`${b.name} ${b.subject}`));
  const remote = info.remote.filter(b => matches(`${b.name} ${b.subject}`));
  const existing = info.worktrees.filter(w => matches(`${w.branch ?? ''} ${w.path} ${w.state ?? ''}`));
  let remaining = Math.max(0, 100
    - Number(Boolean(info.defaultBranch && matches(`${info.defaultBranch} latest remote`)))
    - Number(Boolean(info.current && matches(`${info.current} current`)))
    - Number(Boolean(info.current && info.dirty > 0 && matches(`${info.current} current`))));
  const take = <T,>(items: T[]) => { const visible = items.slice(0, remaining); remaining -= visible.length; return visible; };
  const localRows = take(local);
  const remoteRows = take(remote);
  const existingRows = take(existing);
  const truncated = localRows.length < local.length || remoteRows.length < remote.length || existingRows.length < existing.length;
  const activeBase = value.kind === 'worktree' && value.branch === info.current;
  const chooseWorktree = (branch: string, includeDirty = false) =>
    onChange({ kind: 'worktree', branch, name: branchName, ...(includeDirty ? { includeDirty: true } : {}) });
  const fetch = async () => { setFetching(true); try { await onFetch(); } finally { setFetching(false); } };
  const beginBranch = () => {
    if (!branchName.trim()) return;
    onChange({ kind: 'branch', branch: branchName.trim() });
    setMenuOpen(false);
  };
  const segment = (label: string, selected: boolean, disabled: boolean, choose: () => void, reason?: string) => (
    <button type="button" title={reason} disabled={disabled} onClick={choose} style={{
      height: 20, border: 'none', borderRadius: 5, padding: '0 7px', font: 'inherit', fontSize: 10.5,
      color: selected ? 'var(--text-title)' : 'var(--text-hint)', background: selected ? 'var(--bg-raised)' : 'transparent',
      opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
  return (
    <>
      <div role="group" aria-label="Workspace mode" style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 1, padding: 2, borderRadius: 7, background: 'var(--bg-chip)', flexShrink: 0 }}>
        {segment('Local', mode === 'local', info.detached || currentBusy, () => onModeChange('local'),
          info.detached ? 'HEAD is detached — choose a worktree' : currentBusy ? 'Branch is in use by another session' : undefined)}
        {segment('Worktree', mode === 'worktree', false, () => onModeChange('worktree'))}
      </div>
      <DropdownMenu open={menuOpen} onOpenChange={open => { setMenuOpen(open); if (open) { setQuery(''); onOpen?.(); } }}>
        <DropdownMenuTrigger asChild>
          <button className="hv-sub" style={{ ...chip, maxWidth: 160, minWidth: 0 }} title={title}>
            {icon ?? <GitBranch size={12} style={{ color: 'var(--text-hint)' }} />}
            {info.detached && mode === 'local' ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-amber)', flexShrink: 0 }} /> : null}
            {mode === 'local' && info.dirty > 0 && !info.detached ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-hint)', flexShrink: 0 }} /> : null}
            <span className="ormi-chip-text" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{label}</span>{chev}
          </button>
        </DropdownMenuTrigger>
        {mode === 'local' ? (
          <DropdownMenuContent align="start" style={{ width: 280, maxWidth: 'calc(100vw - 16px)' }}>
            <DropdownMenuLabel>Local branch</DropdownMenuLabel>
            <DropdownMenuItem disabled={info.detached} onSelect={() => onChange({ kind: 'current' })} className="text-xs" style={{ alignItems: 'flex-start' }}>
              {mark(value.kind === 'current')}
              <span className="min-w-0 flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', gap: 8 }}>Stay on <span className="ml-auto truncate" style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{info.current ?? 'detached'}</span></span>
                {info.detached ? <span style={{ color: 'var(--text-hint)', fontSize: 10, whiteSpace: 'normal' }}>HEAD is detached — choose a worktree</span>
                  : currentBusy ? <span style={{ color: 'var(--text-hint)', fontSize: 10, whiteSpace: 'normal' }}>In use by another session — a new worktree will be made</span> : null}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>New branch from {info.current ?? 'current commit'}</DropdownMenuLabel>
            <div style={{ padding: '0 8px 7px' }}>
              <input aria-label="New branch name" value={branchName} onChange={event => onBranchNameChange(event.target.value)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Enter') { event.preventDefault(); beginBranch(); }
                  if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
                }}
                placeholder="ormi/<from prompt>" style={fieldStyle} />
            </div>
            <DropdownMenuItem disabled={!branchName.trim()} onSelect={() => beginBranch()} className="text-xs">
              {mark(value.kind === 'branch' && value.branch === branchName)}<span>Create branch</span>
            </DropdownMenuItem>
            {info.dirty > 0 && value.kind === 'branch' ? <div style={{ padding: '5px 10px', color: 'var(--text-hint)', fontSize: 10 }}>{info.dirty} uncommitted {info.dirty === 1 ? 'change comes' : 'changes come'} along to the new branch</div> : null}
          </DropdownMenuContent>
        ) : (
          <DropdownMenuContent align="start" side="top" collisionPadding={8} avoidCollisions style={{
            width: 300, maxWidth: 'calc(100vw - 16px)',
            maxHeight: 'min(420px, var(--radix-dropdown-menu-content-available-height))', overflowY: 'auto',
          }}>
            <div style={{ padding: '3px 5px 7px', position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-raised)' }}>
              <Search size={12} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-hint)' }} />
              <input aria-label="Search branches and worktrees" value={query} onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
                }} placeholder="Search branches…" style={{ ...fieldStyle, paddingLeft: 25 }} />
            </div>
            {info.defaultBranch && matches(`${info.defaultBranch} latest remote`) ? <>
              <DropdownMenuLabel>Latest remote</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => chooseWorktree(info.defaultBranch!)} className="text-xs">
                {mark(value.kind === 'worktree' && value.branch === info.defaultBranch)}
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{info.defaultBranch}</span>{right('fetches first')}
              </DropdownMenuItem>
            </> : null}
            {info.current && matches(`${info.current} current`) ? <>
              <DropdownMenuSeparator /><DropdownMenuLabel>Current</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => chooseWorktree(info.current!)} className="text-xs">
                {mark(value.kind === 'worktree' && value.branch === info.current)}
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{info.current}</span>
              </DropdownMenuItem>
              {info.dirty > 0 ? <DropdownMenuCheckboxItem checked={Boolean(activeBase && value.kind === 'worktree' && value.includeDirty)}
                disabled={!activeBase} onSelect={event => event.preventDefault()} onCheckedChange={checked => chooseWorktree(info.current!, checked)}
                className="text-xs" style={{ paddingLeft: 32 }}>
                Include {info.dirty} uncommitted {info.dirty === 1 ? 'change' : 'changes'}
              </DropdownMenuCheckboxItem> : null}
            </> : null}
            {localRows.length ? <>
              <DropdownMenuSeparator /><DropdownMenuLabel>Local branches</DropdownMenuLabel>
              {localRows.map(branch => <DropdownMenuItem key={branch.name} onSelect={() => chooseWorktree(branch.name)} className="text-xs">
                {mark(value.kind === 'worktree' && value.branch === branch.name)}
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{branch.name}</span>
                {info.busyBranches.includes(branch.name) ? right('in use') : null}
                <span className="max-w-24 truncate" style={{ color: 'var(--text-hint)', fontSize: 10 }}>{branch.subject}</span>
              </DropdownMenuItem>)}
            </> : null}
            {remoteRows.length ? <>
              <DropdownMenuSeparator /><DropdownMenuLabel>Remote branches</DropdownMenuLabel>
              {remoteRows.map(branch => <DropdownMenuItem key={branch.name} onSelect={() => chooseWorktree(branch.name)} className="text-xs">
                {mark(value.kind === 'worktree' && value.branch === branch.name)}
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{branch.name}</span>
                <span className="max-w-24 truncate" style={{ color: 'var(--text-hint)', fontSize: 10 }}>{branch.subject}</span>
              </DropdownMenuItem>)}
            </> : null}
            {existingRows.length ? <>
              <DropdownMenuSeparator /><DropdownMenuLabel>Existing worktrees</DropdownMenuLabel>
              {existingRows.map(worktree => <DropdownMenuItem key={worktree.path} onSelect={() => onChange({ kind: 'existing', path: worktree.path })} className="text-xs">
                {mark(value.kind === 'existing' && value.path === worktree.path)}
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{worktree.branch ?? worktree.path}</span>
                {right(worktree.state ?? 'unused')}
              </DropdownMenuItem>)}
            </> : null}
            {truncated ? <div style={{ padding: '5px 10px', color: 'var(--text-hint)', fontSize: 10 }}>100 shown — refine search</div> : null}
            {info.dirty > 0 && value.kind === 'worktree' ? <div style={{ padding: '4px 10px', color: 'var(--text-hint)', fontSize: 10 }}>{info.dirty} uncommitted {info.dirty === 1 ? 'change stays' : 'changes stay'} in the main checkout</div> : null}
            <DropdownMenuSeparator />
            {value.kind !== 'existing' ? <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px' }}>
              <span style={{ color: 'var(--text-hint)', fontSize: 10, flexShrink: 0 }}>Branch:</span>
              {editingName ? <input aria-label="Worktree branch name" value={branchName} onChange={event => onBranchNameChange(event.target.value)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
                }} autoFocus style={{ ...fieldStyle, height: 23, minWidth: 0 }} />
                : <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{branchName}</span>}
              <button type="button" aria-label="Edit branch name" title="Edit branch name" onClick={() => setEditingName(value => !value)}
                style={{ border: 0, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer', padding: 2 }}><Pencil size={12} /></button>
            </div> : null}
            <DropdownMenuItem disabled={fetching} onSelect={event => { event.preventDefault(); void fetch(); }} className="text-xs">
              {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              <span>{fetching ? 'Fetching…' : 'Fetch'}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </>
  );
}
