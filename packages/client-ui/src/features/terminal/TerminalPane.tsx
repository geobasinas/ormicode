/** Terminal side panel (Desktop — Terminal mockup): shell tabs, + for a new
 *  shell at the session's folder, and the active xterm in a rounded card. */
import { Plus, SquareTerminal, X, Maximize2, Columns2 } from 'lucide-react';
import { useTerminalTabs } from './useTerminalTabs.ts';
import { TerminalView } from './TerminalView.tsx';

const iconBtn = { border: 'none', background: 'transparent', color: 'var(--text-hint)', display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, cursor: 'pointer' } as const;

export function TerminalPane({ session }: { session: string }) {
  const { tabs, active, setActive, open, close, markExited, error } = useTerminalTabs(session);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 6px 8px', gap: 2 }}>
      <div className="ormi-tabs" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 38, flexShrink: 0, overflowX: 'auto' }}>
        {tabs.map(t => {
          const on = t.terminal === active;
          return (
            <span key={t.terminal} onClick={() => setActive(t.terminal)} className={on ? undefined : 'hv'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)', fontSize: 11, background: on ? 'var(--bg-raised)' : 'transparent',
              color: on ? 'var(--text-active)' : 'var(--text-hint)', opacity: t.exited ? 0.6 : 1,
            }}>
              <SquareTerminal size={12} />{t.shell}
              <X size={11} style={{ color: 'var(--text-hint)' }} onClick={e => { e.stopPropagation(); close(t.terminal); }} />
            </span>
          );
        })}
        <button title="New terminal" className="hv" style={iconBtn} onClick={() => void open()}><Plus size={14} /></button>
        <span style={{ flex: 1 }} />
        <button title="Splits — not supported (tabs only)" style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }}><Columns2 size={13} /></button>
        <button title="Maximize — soon" style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }}><Maximize2 size={13} /></button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--bg-inset)', border: '1px solid var(--line-card)', borderRadius: 10, padding: 10, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 10 }}>
          {tabs.map(t => <TerminalView key={t.terminal} terminal={t.terminal} visible={t.terminal === active} onExit={() => markExited(t.terminal)} />)}
        </div>
        {error ? <div style={{ position: 'absolute', left: 12, bottom: 10, color: 'var(--accent-red)', fontSize: 11 }}>{error}</div> : null}
      </div>
    </div>
  );
}
