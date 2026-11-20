import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export function turnDuration(start: number, end: number, running: boolean): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const duration = minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  return `${running ? 'Working' : 'Worked'} for ${duration}`;
}

export function TurnActivity({ start, end, running, activity, children }: {
  start: number; end: number; running: boolean; activity: ReactNode; children: ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, start]);
  const open = running || expanded;
  return <section aria-label="Agent turn">
    <button type="button" aria-expanded={open} disabled={running} onClick={() => setExpanded(value => !value)} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', border: 'none', background: 'transparent',
      color: 'var(--text-hint)', font: 'inherit', fontSize: 12, cursor: running ? 'default' : 'pointer',
    }}>
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{turnDuration(start, running ? now : end, running)}
    </button>
    {open ? <div data-turn-activity>{activity}</div> : null}
    {children}
  </section>;
}
