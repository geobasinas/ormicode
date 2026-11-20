import { useState } from 'react';
import { AlertTriangle, Bug, CircleAlert, Info, Network } from 'lucide-react';
import type { PreviewConsoleEntry } from '@ormicode/protocol';

const age = (ts: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
};

export function BrowserConsoleList({ entries, dropped, filter, onAdd, onSend }: {
  entries: PreviewConsoleEntry[]; dropped: number; filter: 'all' | 'errors' | 'network';
  onAdd: (entry: PreviewConsoleEntry) => void; onSend: (entry: PreviewConsoleEntry) => void;
}) {
  const visible = entries.filter(entry => filter === 'all' || (filter === 'errors' ? entry.level === 'error' : entry.kind === 'network'));
  const [expanded, setExpanded] = useState<string>();
  return <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 8px', background: 'var(--bg-inset)' }}>
    {dropped ? <div style={{ padding: '4px 2px', color: 'var(--text-hint)', fontSize: 10 }}>{dropped} report entries dropped by the rate limit</div> : null}
    {visible.map(entry => {
      const Icon = entry.level === 'error' ? CircleAlert
        : entry.level === 'warn' ? AlertTriangle
          : entry.kind === 'network' ? Network : entry.kind === 'console' ? Bug : Info;
      const open = expanded === entry.id;
      return <article key={entry.id} className="ormi-browser-console-row" style={{ padding: '5px 3px', borderBottom: '1px solid var(--line-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Icon size={13} style={{ flexShrink: 0, color: entry.level === 'error' ? 'var(--accent-red)' : entry.level === 'warn' ? 'var(--accent-amber)' : 'var(--text-hint)' }} />
          <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? undefined : entry.id)}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', border: 0, padding: 0, background: 'transparent', color: 'var(--text-label)', textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: 'inherit', fontSize: 11.5, cursor: 'pointer' }}>
            {entry.message}
          </button>
          <span style={{ flexShrink: 0, maxWidth: '32%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-hint)', fontSize: 9.5, textAlign: 'right' }}>{entry.source ?? entry.path} · {age(entry.ts)}</span>
          <div className="ormi-browser-console-actions" style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            <button type="button" onClick={() => onSend(entry)} title="Send to agent" className="hv">Send to agent</button>
            <button type="button" onClick={() => onAdd(entry)} title="Add to composer" className="hv">Add</button>
          </div>
        </div>
        {open ? <div style={{ margin: '5px 0 0 19px', padding: 8, border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          <div style={{ marginBottom: 5, color: 'var(--text-label)', fontFamily: 'var(--font-ui)', fontSize: 11, whiteSpace: 'pre-wrap' }}>{entry.message}</div>
          {entry.source ? <div style={{ marginBottom: 5 }}>Source: {entry.source}{entry.line ? `:${entry.line}:${entry.col ?? 0}` : ''}</div> : null}
          {entry.stack ? <div style={{ marginBottom: 5 }}><div style={{ color: 'var(--text-hint)' }}>Stack</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{entry.stack}</pre></div> : null}
          {entry.method || entry.url || entry.status !== undefined ? <div style={{ marginBottom: 5 }}>{entry.method} {entry.url}{entry.status === undefined ? '' : ` · ${entry.status}`}{entry.durationMs === undefined ? '' : ` · ${entry.durationMs}ms`}</div> : null}
          {entry.requestBody ? <div style={{ marginBottom: 5 }}><div style={{ color: 'var(--text-hint)' }}>Request</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{entry.requestBody}</pre></div> : null}
          {entry.responseBody ? <div><div style={{ color: 'var(--text-hint)' }}>Response</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{entry.responseBody}</pre></div> : null}
        </div> : null}
      </article>;
    })}
    {!visible.length ? <div style={{ padding: 16, color: 'var(--text-hint)', fontSize: 11, textAlign: 'center' }}>{entries.length ? 'No matching preview events' : 'No console messages yet.'}</div> : null}
  </div>;
}
