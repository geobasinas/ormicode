/** Session header (tab strip, right side): machine chip and a session menu
 * containing only actions the protocol supports today. */
import { useEffect, useState } from 'react';
import { Ellipsis, Laptop } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import type { SessionDetails } from './useSession.ts';


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
      padding: '0 11px 0 var(--space-3)', flexShrink: 1,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, height: 24, boxSizing: 'border-box', flexShrink: 0,
        color: '#b7b7b7', padding: '0 9px', borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid var(--line-card)',
      }}><Laptop size={12} />{machine}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="hv" aria-label="session menu" style={{ width: 24, height: 24, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-label)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}><Ellipsis size={15} /></button></DropdownMenuTrigger>
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
