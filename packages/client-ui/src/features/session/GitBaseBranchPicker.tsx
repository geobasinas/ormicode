import type { KeyboardEvent } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { BranchActionMenu, type BranchMenuAction } from './BranchActionMenu.tsx';
import type { BranchInfo, RepoInfo } from './GitWorkspacePopover.tsx';

export type BaseOption = {
  group: string; name: string; subject: string; ts: number;
  ahead?: number; behind?: number; upstream?: string | null; hint?: string;
};

const fieldStyle = {
  height: 26, width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-main)',
  color: 'var(--text-title)', font: 'inherit', fontSize: 11, padding: '0 7px',
};
const quiet = { color: 'var(--text-hint)', fontSize: 11 };

export function GitBaseBranchPicker({ info, base, options, search, onSearch, activeIndex, onActiveIndex, onKeyDown, onChoose, truncated, onAction, pulling, pullResult }: {
  info: RepoInfo; base: string; options: BaseOption[]; search: string;
  onSearch: (value: string) => void; activeIndex: number; onActiveIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void; onChoose: (name: string) => void;
  truncated: boolean; onAction: (action: BranchMenuAction, branch: BranchInfo) => void;
  pulling?: string; pullResult: Record<string, string>;
}) {
  return <div>
    <label htmlFor="ormi-git-base" style={{ display: 'block', ...quiet, marginBottom: 5 }}>Base</label>
    <div style={{ position: 'relative' }}>
      <Search size={12} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-hint)' }} />
      <input id="ormi-git-base" role="combobox" aria-label="Base branch" aria-expanded="true" aria-controls="ormi-git-base-options"
        aria-activedescendant={options[activeIndex] ? `ormi-git-base-${activeIndex}` : undefined}
        value={search} onChange={event => { onSearch(event.target.value); onActiveIndex(0); }}
        onKeyDown={onKeyDown} placeholder={base ? `Filter branches · ${base}` : 'Filter branches…'} style={{ ...fieldStyle, paddingLeft: 25 }} />
    </div>
    <div id="ormi-git-base-options" role="listbox" aria-label="Base branches" style={{
      maxHeight: 'min(180px, max(72px, calc(var(--radix-popover-content-available-height) - 400px)))',
      overflowY: 'auto', marginTop: 5, border: '1px solid var(--line-card)', borderRadius: 6, padding: 3,
    }}>
      {options.map((option, index) => {
        const inUse = info.busyBranches.includes(option.name);
        const branch = info.local.find(item => item.name === option.name)
          ?? info.remote.find(item => item.name === option.name)
          ?? { name: option.name, subject: option.subject, ts: option.ts };
        return <div key={`${option.group}:${option.name}`}>
          {index === 0 || option.group !== options[index - 1]?.group ? <div style={{ ...quiet, fontSize: 10, padding: '5px 6px 3px' }}>{option.group}</div> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button id={`ormi-git-base-${index}`} type="button" role="option" aria-selected={base === option.name}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => onActiveIndex(index)} onClick={() => onChoose(option.name)}
              style={{
                width: '100%', minWidth: 0, minHeight: 36, display: 'flex', alignItems: 'center', gap: 7,
                border: 0, borderRadius: 4, padding: '4px 6px', textAlign: 'left',
                color: activeIndex === index ? 'var(--text-active)' : 'var(--text-secondary)', background: activeIndex === index ? 'var(--bg-selected)' : 'transparent',
                font: 'inherit', cursor: 'pointer',
              }}>
              <span style={{ width: 14, flexShrink: 0, color: 'var(--text-title)' }}>{base === option.name ? <Check size={12} /> : null}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11.5 }} className="truncate">{option.name}</span>
                <span style={{ display: 'block', ...quiet, fontSize: 10 }} className="truncate">
                  {[option.hint, option.subject, option.ts ? shortAge(option.ts) : ''].filter(Boolean).join(' · ')}
                </span>
                {pullResult[option.name] ? <span style={{ display: 'block', ...quiet, fontSize: 9 }} className="truncate">{pullResult[option.name]}</span> : null}
              </span>
              {option.ahead || option.behind ? <span style={{ ...quiet, fontSize: 9, whiteSpace: 'nowrap' }}>
                {option.ahead ? `↑${option.ahead} ` : ''}{option.behind ? `↓${option.behind} ` : ''}vs {option.upstream ?? ''}
              </span> : null}
              {inUse ? <span style={{ ...quiet, fontSize: 9, whiteSpace: 'nowrap' }}>in use</span> : null}
            </button>
            {pulling === option.name ? <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-hint)' }} /> : null}
            <BranchActionMenu branch={branch} info={info} management={false}
              onAction={onAction} pulling={pulling === option.name} />
          </div>
        </div>;
      })}
      {!options.length ? <div style={{ ...quiet, padding: 8 }}>No matching branches</div> : null}
      {truncated ? <div style={{ ...quiet, fontSize: 10, padding: 5 }}>100 shown — refine search</div> : null}
    </div>
  </div>;
}

function shortAge(ts: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
