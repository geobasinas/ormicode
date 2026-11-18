/** Session header: title + machine, state pill, vendor/model/effort, and a
 * session menu containing only actions the protocol supports today. */
import { useEffect, useState } from 'react';
import { Ellipsis, Laptop } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { projectName } from '../../lib/format.ts';
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
  const { transport, desktop } = usePlatform();
  const [copied, setCopied] = useState(false);
  const [machine, setMachine] = useState('local');
  useEffect(() => {
    try {
      const r = desktop?.remote?.();
      if (r?.relayUrl) setMachine(new URL(r.relayUrl).hostname);
    } catch { /* keep local */ }
  }, [desktop]);
  const state = details?.state ?? '…';
  const canPause = state === 'running' || state === 'retrying';
  const canResume = state === 'interrupted' || state === 'paused_rate_limited';
  const canStop = ['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(state);
  const act = (m: string) => void transport.request(m, { session });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 30, minWidth: 0,
      padding: '0 0 0 var(--space-3)', flexShrink: 1,
    }}>
      <span style={{
        fontSize: 10.5, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap',
        color: pillColor[state] ?? 'var(--text-hint)', border: `1px solid ${pillColor[state] ?? 'var(--line-card)'}`,
      }}>{stateLabel[state] ?? state}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {[details?.project && projectName(details.project), details?.branch, details?.vendor, details?.model, details?.effort].filter(Boolean).join(' · ')}
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, height: 20, flexShrink: 0,
        color: '#b7b7b7', padding: '0 9px', borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid var(--line-card)',
      }}><Laptop size={12} />{machine}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="session menu"><Ellipsis size={16} /></Button></DropdownMenuTrigger>
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
