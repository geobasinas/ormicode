/** Session header: title + machine, state pill, vendor/model/effort, and a
 * session menu containing only actions the protocol supports today. */
import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { Button } from '../../components/Button.tsx';
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
  const [copied, setCopied] = useState(false);
  const state = details?.state ?? '…';
  const canPause = state === 'running' || state === 'retrying';
  const canResume = state === 'interrupted' || state === 'paused_rate_limited';
  const canStop = ['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(state);
  const act = (m: string) => void transport.request(m, { session });

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button aria-label="session menu"><Ellipsis size={16} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canPause ? <DropdownMenuItem onClick={() => act('session.pause')}>Pause session</DropdownMenuItem> : null}
          {canResume ? <DropdownMenuItem onClick={() => act('session.resume')}>Resume session</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => {
            void navigator.clipboard.writeText(session);
            setCopied(true); setTimeout(() => setCopied(false), 1200);
          }}>{copied ? 'Copied!' : 'Copy session id'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => act('session.archive')}>Archive session</DropdownMenuItem>
          {canStop ? <DropdownMenuItem variant="destructive" onClick={() => act('session.abort')}>Stop session</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
