import { ArrowDownToLine, ChevronDown, Eraser, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BrowserIconButton, BrowserTooltip } from './browser-ui.tsx';
import { BrowserConsoleList } from './BrowserConsoleList.tsx';
import type { PreviewConsoleEntry } from '@ormicode/protocol';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';

export function BrowserLogDrawer({ service, services, lines, height, follow, tab, unread, unreadErrors, entries, dropped, filter,
  onTabChange, onFilterChange, onConsoleClear, onConsoleAdd, onConsoleSend, onServiceChange, onFollowChange, onClear, onClose, onScroll }: {
  service: string; services: string[]; lines: { text: string; stream: 'stdout' | 'stderr' }[]; height: number; follow: boolean;
  tab: 'logs' | 'console'; unread: number; unreadErrors: number; entries: PreviewConsoleEntry[]; dropped: number;
  filter: 'all' | 'errors' | 'network'; onTabChange: (tab: 'logs' | 'console') => void;
  onFilterChange: (filter: 'all' | 'errors' | 'network') => void; onConsoleClear: () => void;
  onConsoleAdd: (entry: PreviewConsoleEntry) => void; onConsoleSend: (entry: PreviewConsoleEntry) => void;
  onServiceChange: (service: string) => void; onFollowChange: (follow: boolean) => void;
  onClear: () => void; onClose: () => void; onScroll: (atBottom: boolean) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [follow, lines]);
  return <section style={{ height, minHeight: 100, flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line-card)', background: 'var(--bg-main)' }}>
    <header style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid var(--line-subtle)' }}>
      <div role="tablist" aria-label="Preview output" style={{ display: 'flex', gap: 2, padding: 2, border: '1px solid var(--line-card)', borderRadius: 7, background: 'var(--bg-inset)' }}>
        {(['logs', 'console'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTabChange(value)}
          className={tab === value ? 'ormi-selected-row' : 'hv'} style={{ height: 23, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 7px', border: 0, borderRadius: 5, background: tab === value ? 'var(--bg-selected)' : 'transparent', color: tab === value ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>
          {value === 'logs' ? 'Logs' : 'Console'}
          {value === 'console' && unread ? <span style={{ minWidth: 15, height: 15, display: 'inline-grid', placeItems: 'center', padding: '0 3px', borderRadius: 8, background: unreadErrors ? 'var(--accent-red)' : 'var(--accent-amber)', color: 'var(--text-onAccent)', fontSize: 9 }}>{unread > 99 ? '99+' : unread}</span> : null}
        </button>)}
      </div>
      {tab === 'logs' ? <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" aria-label="Log service" className="hv" style={{ height: 25, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-label)', fontSize: 10.5, cursor: 'pointer' }}>{service || 'Service'} <ChevronDown size={12} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={service} onValueChange={onServiceChange}>
          {services.map(name => <DropdownMenuRadioItem key={name} value={name}>{name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu> : <div style={{ display: 'flex', gap: 2, padding: 2, border: '1px solid var(--line-card)', borderRadius: 7, background: 'var(--bg-inset)' }}>
        {(['all', 'errors', 'network'] as const).map(value => {
          const count = value === 'all' ? entries.length : value === 'errors'
            ? entries.filter(entry => entry.level === 'error').length
            : entries.filter(entry => entry.kind === 'network').length;
          return <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}
            className={filter === value ? 'ormi-selected-row' : 'hv'} style={{ height: 22, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', border: 0, borderRadius: 5, background: filter === value ? 'var(--bg-selected)' : 'transparent', color: filter === value ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 9.5, cursor: 'pointer' }}>
            {value === 'all' ? 'All' : value === 'errors' ? 'Errors' : 'Network'} <span style={{ color: 'var(--text-hint)', fontSize: 9 }}>{count}</span>
          </button>;
        })}
      </div>}
      <span style={{ flex: 1 }} />
      {tab === 'logs' ? <BrowserTooltip label="Follow the latest log line"><button type="button" aria-label="Follow" aria-pressed={follow} onClick={() => onFollowChange(!follow)}
        className={follow ? 'ormi-selected-row' : 'hv'} style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', border: 0, borderRadius: 6, background: follow ? 'var(--bg-selected)' : 'transparent', color: follow ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>
        <ArrowDownToLine size={12} />Follow
      </button></BrowserTooltip> : null}
      <BrowserIconButton title={tab === 'logs' ? 'Clear view' : 'Clear console'} onClick={tab === 'logs' ? onClear : onConsoleClear}><Eraser size={13} /></BrowserIconButton>
      <BrowserIconButton title="Close drawer" onClick={onClose}><X size={14} /></BrowserIconButton>
    </header>
    {tab === 'console' ? <BrowserConsoleList entries={entries} dropped={dropped} filter={filter} onAdd={onConsoleAdd} onSend={onConsoleSend} /> : <div ref={body} tabIndex={0} onScroll={event => {
      const el = event.currentTarget;
      onScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 12);
    }} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '5px 9px', background: 'var(--bg-inset)', color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.45 }}>
      {lines.map((line, index) => <div key={`${index}:${line.stream}:${line.text}`} style={{ minHeight: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: line.stream === 'stderr' ? 'var(--accent-red)' : 'var(--text-label)' }}>{line.text}</div>)}
    </div>}
  </section>;
}
