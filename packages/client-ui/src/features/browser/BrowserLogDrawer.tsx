import { ArrowDownToLine, Eraser, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BrowserIconButton } from './browser-ui.tsx';
import { BrowserConsoleList } from './BrowserConsoleList.tsx';
import type { PreviewConsoleEntry } from '@ormicode/protocol';

export function BrowserLogDrawer({ service, services, lines, height, follow, tab, unread, entries, dropped, filter,
  onTabChange, onFilterChange, onConsoleClear, onConsoleAdd, onConsoleSend, onServiceChange, onFollowChange, onClear, onClose, onScroll }: {
  service: string; services: string[]; lines: string[]; height: number; follow: boolean;
  tab: 'logs' | 'console'; unread: number; entries: PreviewConsoleEntry[]; dropped: number;
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
      <button type="button" role="tab" aria-selected={tab === 'logs'} onClick={() => onTabChange('logs')} className={tab === 'logs' ? 'ormi-selected-row' : 'hv'}
        style={{ height: 25, padding: '0 8px', border: 0, borderRadius: 6, background: tab === 'logs' ? 'var(--bg-selected)' : 'transparent', color: tab === 'logs' ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>Logs</button>
      <button type="button" role="tab" aria-selected={tab === 'console'} onClick={() => onTabChange('console')} className={tab === 'console' ? 'ormi-selected-row' : 'hv'}
        style={{ height: 25, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 8px', border: 0, borderRadius: 6, background: tab === 'console' ? 'var(--bg-selected)' : 'transparent', color: tab === 'console' ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>
        Console{unread ? <span style={{ minWidth: 15, height: 15, display: 'inline-grid', placeItems: 'center', padding: '0 3px', borderRadius: 8, background: 'var(--accent-red)', color: 'var(--text-onAccent)', fontSize: 9 }}>{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {tab === 'logs' ? <select aria-label="Log service" className="ormi-select" value={service} onChange={event => onServiceChange(event.target.value)}
        style={{ maxWidth: 138, minWidth: 64, height: 24, padding: '2px 22px 2px 7px', border: '1px solid var(--line-card)', borderRadius: 6, backgroundColor: 'var(--bg-card)', color: 'var(--text-label)', fontSize: 11 }}>
        {services.map(name => <option key={name} value={name}>{name}</option>)}
      </select> : <div style={{ display: 'flex', gap: 3 }}>
        {(['all', 'errors', 'network'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}
          className={filter === value ? 'ormi-selected-row' : 'hv'} style={{ height: 23, padding: '0 6px', border: 0, borderRadius: 5, background: filter === value ? 'var(--bg-selected)' : 'transparent', color: filter === value ? 'var(--text-active)' : 'var(--text-hint)', fontSize: 9.5, cursor: 'pointer' }}>
          {value === 'all' ? 'All' : value === 'errors' ? 'Errors' : 'Network'}
        </button>)}
      </div>}
      <span style={{ flex: 1 }} />
      {tab === 'logs' ? <button type="button" title="Follow the latest log line" aria-pressed={follow} onClick={() => onFollowChange(!follow)}
        className={follow ? 'ormi-selected-row' : 'hv'} style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', border: 0, borderRadius: 6, background: follow ? 'var(--bg-selected)' : 'transparent', color: follow ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>
        <ArrowDownToLine size={12} />Follow
      </button> : null}
      <BrowserIconButton title={tab === 'logs' ? 'Clear view' : 'Clear console'} onClick={tab === 'logs' ? onClear : onConsoleClear}><Eraser size={13} /></BrowserIconButton>
      <BrowserIconButton title="Close drawer" onClick={onClose}><X size={14} /></BrowserIconButton>
    </header>
    {tab === 'console' ? <BrowserConsoleList entries={entries} dropped={dropped} filter={filter} onAdd={onConsoleAdd} onSend={onConsoleSend} /> : <div ref={body} tabIndex={0} onScroll={event => {
      const el = event.currentTarget;
      onScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 12);
    }} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '5px 9px', background: 'var(--bg-inset)', color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.45 }}>
      {lines.map((line, index) => <div key={`${index}:${line}`} style={{ minHeight: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line}</div>)}
    </div>}
  </section>;
}
