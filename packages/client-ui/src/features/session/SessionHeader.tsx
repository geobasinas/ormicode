/** Session header: title + machine, state pill, vendor/model/effort, and a
 * session menu containing only actions the protocol supports today. */
import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from './useSession.ts';

const pillColor: Record<string, string> = {
  running: 'var(--accent-mint)', starting: 'var(--accent-mint)', retrying: 'var(--accent-amber)',
  awaiting_approval: 'var(--accent-amber)', awaiting_input: 'var(--accent-amber)',
  paused_rate_limited: 'var(--accent-amber)', interrupted: 'var(--accent-amber)',
  failed: 'var(--accent-red)', idle: 'var(--text-hint)', done: 'var(--text-secondary)', archived: 'var(--text-hint)',
};
const stateLabel: Record<string, string> = {
  awaiting_approval: 'awaiting approval', awaiting_input: 'awaiting input',
  paused_rate_limited: 'rate limited',
};

export function SessionHeader({ session, details }: { session: string; details: SessionDetails | undefined }) {
  const { transport } = usePlatform();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = details?.state ?? '…';
  const canPause = state === 'running' || state === 'retrying';
  const canResume = state === 'interrupted' || state === 'paused_rate_limited';
  const canStop = ['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(state);
  const act = (m: string) => { setMenu(false); void transport.request(m, { session }); };

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const item = (label: string, fn: () => void, danger = false) => (
    <button onClick={fn} style={{
      display: 'block', width: '100%', textAlign: 'left', font: 'inherit', fontSize: 'var(--text-sm)',
      padding: '6px var(--space-3)', background: 'none', border: 'none', cursor: 'pointer',
      color: danger ? 'var(--accent-red)' : 'var(--text-label)',
    }}>{label}</button>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--line-card)',
      background: 'var(--bg-window)', flexShrink: 0,
    }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>{details?.project ?? ''}</span>
      <span style={{ color: 'var(--text-title)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
        {details?.title || session.slice(0, 14)}
      </span>
      <span style={{
        fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 999,
        color: pillColor[state] ?? 'var(--text-hint)', border: `1px solid ${pillColor[state] ?? 'var(--line-card)'}`,
      }}>{stateLabel[state] ?? state}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
        {[details?.vendor, details?.model, details?.effort].filter(Boolean).join(' · ')}
      </span>
      <span style={{ flex: 1 }} />
      <div ref={ref} style={{ position: 'relative' }}>
        <button onClick={() => setMenu(m => !m)} style={{
          font: 'inherit', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
        }}>⋯</button>
        {menu ? (
          <div style={{
            position: 'absolute', right: 0, top: '100%', zIndex: 10, minWidth: 190,
            background: 'var(--bg-raised)', border: '1px solid var(--line-card)',
            borderRadius: 'var(--radius-md)', padding: 'var(--space-1)', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            {canPause ? item('Pause session', () => act('session.pause')) : null}
            {canResume ? item('Resume session', () => act('session.resume')) : null}
            {item(copied ? 'Copied!' : 'Copy session id', () => { void navigator.clipboard.writeText(session); setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            {item('Archive session', () => act('session.archive'))}
            {canStop ? item('Stop session', () => act('session.abort'), true) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
