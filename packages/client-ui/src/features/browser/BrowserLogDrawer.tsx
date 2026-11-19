import { ArrowDownToLine, Eraser, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BrowserIconButton } from './browser-ui.tsx';

export function BrowserLogDrawer({ service, services, lines, height, follow, onServiceChange, onFollowChange, onClear, onClose, onScroll }: {
  service: string; services: string[]; lines: string[]; height: number; follow: boolean;
  onServiceChange: (service: string) => void; onFollowChange: (follow: boolean) => void;
  onClear: () => void; onClose: () => void; onScroll: (atBottom: boolean) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [follow, lines]);
  return <section style={{ height, minHeight: 100, flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line-card)', background: 'var(--bg-main)' }}>
    <header style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid var(--line-subtle)' }}>
      <span style={{ color: 'var(--text-hint)', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.7 }}>LOGS</span>
      <select aria-label="Log service" className="ormi-select" value={service} onChange={event => onServiceChange(event.target.value)}
        style={{ maxWidth: 138, height: 24, padding: '2px 22px 2px 7px', border: '1px solid var(--line-card)', borderRadius: 6, backgroundColor: 'var(--bg-card)', color: 'var(--text-label)', fontSize: 11 }}>
        {services.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <span style={{ flex: 1 }} />
      <button type="button" title="Follow the latest log line" aria-pressed={follow} onClick={() => onFollowChange(!follow)}
        className={follow ? 'ormi-selected-row' : 'hv'} style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', border: 0, borderRadius: 6, background: follow ? 'var(--bg-selected)' : 'transparent', color: follow ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 10.5, cursor: 'pointer' }}>
        <ArrowDownToLine size={12} />Follow
      </button>
      <BrowserIconButton title="Clear view" onClick={onClear}><Eraser size={13} /></BrowserIconButton>
      <BrowserIconButton title="Close logs" onClick={onClose}><X size={14} /></BrowserIconButton>
    </header>
    <div ref={body} tabIndex={0} onScroll={event => {
      const el = event.currentTarget;
      onScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 12);
    }} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '5px 9px', background: 'var(--bg-inset)', color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.45 }}>
      {lines.map((line, index) => <div key={`${index}:${line}`} style={{ minHeight: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line}</div>)}
    </div>
  </section>;
}
