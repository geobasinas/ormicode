/** Composer mega-chips for new sessions: one chip bundling agent + transport +
 * model + effort (nested submenus), and one chip for the git workspace choice
 * (current branch / new branch / worktree from a branch). */
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Cpu, Gauge, RefreshCw } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { chip } from './composer-parts.tsx';
import { VendorIcon } from './vendor-icons.tsx';
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

/** Brand mark on a neutral tile. */
const tile = (vendor: string) => (
  <span style={{
    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
    background: 'var(--bg-chip)',
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
export function AgentChip({ vendor, via, agents, onPick, model, models, onModel, effort, onEffort, loading, refresh, icon, title, fullWidth, showDefaults }: {
  vendor: string; via: string; agents: { vendor: string; transports: string[] }[];
  onPick: (vendor: string, transport: string) => void;
  model: string; models: ListedModel[]; onModel: (id: string) => void;
  effort: string; onEffort: (v: string) => void;
  loading: boolean; refresh: () => Promise<unknown>; icon?: ReactNode; title?: string; fullWidth?: boolean; showDefaults?: boolean;
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
        <button className="hv-sub" style={fullWidth ? { ...chip, width: '100%', minWidth: 0, justifyContent: 'flex-start' } : chip} title={title}>
          {icon ?? <VendorIcon vendor={vendor} size={11} />}
          <span className="ormi-chip-text">
            {pair}
            {model !== 'default' || showDefaults ? ` · ${current?.label ?? model}` : ''}
            {effort !== 'default' || showDefaults ? ` · ${effort}` : ''}
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

export { GitChip, branchNameIssue } from './GitWorkspacePopover.tsx';
export type { RepoInfo, WorkspaceChoice, WorkspaceMode } from './GitWorkspacePopover.tsx';
