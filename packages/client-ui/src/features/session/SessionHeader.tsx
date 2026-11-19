/** Session header (tab strip, right side): machine chip and a session menu
 * containing only actions the protocol supports today. */
import { useEffect, useState } from 'react';
import { Ellipsis, Laptop } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import type { SessionDetails } from './useSession.ts';
import { CopyOutDialog } from './CopyOutDialog.tsx';


export function SessionHeader({ session, details, onOpen, onHandoff }: { session: string; details: SessionDetails | undefined; onOpen?: (session: string) => void; onHandoff?(): void }) {
  const { transport, desktop } = usePlatform();
  const [copied, setCopied] = useState(false);
  const [machine, setMachine] = useState('local');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(details?.title ?? '');
  const [copying, setCopying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    try {
      const r = desktop?.remote?.();
      if (r?.relayUrl) setMachine(new URL(r.relayUrl).hostname);
    } catch { /* keep local */ }
  }, [desktop]);
  const state = details?.state ?? '…';
  useEffect(() => setTitle(details?.title ?? ''), [details?.title]);
  const canPause = state === 'running' || state === 'retrying';
  const canResume = state === 'interrupted' || state === 'paused_rate_limited';
  const canStop = ['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(state);
  const act = (m: string) => void transport.request(m, { session });
  const rename = async () => {
    const result = await transport.request('session.rename', { session, title: title.trim() });
    if (result.type === 'res') setRenaming(false);
  };
  const exportTranscript = async () => {
    const result = await transport.request('session.export', { session, format: 'markdown' });
    if (result.type !== 'res') return;
    const text = String(result.body.text ?? '');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(details?.title || 'session').replace(/[^\w.-]+/g, '-')}.md`; a.click();
    URL.revokeObjectURL(url);
  };
  const forkLatest = async () => {
    const listed = await transport.request('checkpoint.list', { session });
    if (listed.type !== 'res') return;
    const checkpoint = (listed.body.checkpoints as { id: string }[] | undefined)?.[0];
    if (!checkpoint) return;
    const fork = await transport.request('checkpoint.fork', { session, id: checkpoint.id });
    if (fork.type === 'res' && typeof fork.body.session === 'string') onOpen?.(fork.body.session);
  };

  return <>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 30, minWidth: 0,
      padding: '0 11px 0 var(--space-3)', flexShrink: 1,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, height: 24, boxSizing: 'border-box', flexShrink: 0,
        color: 'var(--text-label)', padding: '0 9px', borderRadius: 6,
        background: 'var(--bg-card)', border: '1px solid var(--line-card)',
      }}><Laptop size={12} />{machine}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="hv" aria-label="session menu" style={{ width: 24, height: 24, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-label)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}><Ellipsis size={15} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={event => { event.preventDefault(); setRenaming(true); }}>Rename…</DropdownMenuItem>
          {renaming ? <div style={{ padding: '5px 8px', display: 'flex', gap: 5 }}>
            <input autoFocus value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); void rename(); }
              if (event.key === 'Escape') setRenaming(false);
            }} style={{ width: 180, minWidth: 0, height: 26, padding: '0 7px', border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 12 }} />
            <button onClick={() => void rename()} style={{ border: 0, background: 'var(--bg-raised)', color: 'var(--text-active)', borderRadius: 5, padding: '0 7px', cursor: 'pointer' }}>Save</button>
          </div> : null}
          {details?.cwd ? <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(details.cwd!)}>Copy path</DropdownMenuItem> : null}
          {details?.cwd && desktop ? <DropdownMenuItem onClick={() => void desktop.openPath(details.cwd!)}>Open worktree folder</DropdownMenuItem> : null}
          {details?.project === 'scratch' ? <DropdownMenuItem onSelect={() => setCopying(true)}>Copy to project…</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => void exportTranscript()}>Export transcript as Markdown</DropdownMenuItem>
          {details?.project !== 'scratch' ? <DropdownMenuItem onClick={() => void forkLatest()}>Fork from latest checkpoint</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={onHandoff}>Hand off…</DropdownMenuItem>
          {canPause ? <DropdownMenuItem onClick={() => act('session.pause')}>Pause session</DropdownMenuItem> : null}
          {canResume ? <DropdownMenuItem onClick={() => act('session.resume')}>Resume session</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => {
            void navigator.clipboard.writeText(session);
            setCopied(true); setTimeout(() => setCopied(false), 1200);
          }}>{copied ? 'Copied!' : 'Copy session id'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => act('session.archive')}>Archive session</DropdownMenuItem>
          {details?.project === 'scratch' ? <DropdownMenuItem onSelect={event => { event.preventDefault(); setConfirmDelete(true); }}>Delete session…</DropdownMenuItem> : null}
          {confirmDelete && details?.project === 'scratch' ? <div style={{ padding: '7px 10px', width: 240 }}>
            <div style={{ fontSize: 11, color: 'var(--accent-amber)', marginBottom: 7 }}>
              Deletes the scratch folder and {details.scratchFiles ?? 0} files
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={() => setConfirmDelete(false)} style={smallButton}>Cancel</button>
              <button onClick={() => { setConfirmDelete(false); void act('session.delete'); }} style={{ ...smallButton, color: 'var(--accent-red)' }}>Delete</button>
            </div>
          </div> : null}
          {canStop ? <DropdownMenuItem variant="destructive" onClick={() => act('session.abort')}>Stop session</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {copying && details?.project === 'scratch' ? <CopyOutDialog session={session} onClose={() => setCopying(false)} /> : null}
  </>;
}

const smallButton = { border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-raised)', color: 'var(--text-secondary)', padding: '4px 7px', font: 'inherit', fontSize: 10.5, cursor: 'pointer' };
