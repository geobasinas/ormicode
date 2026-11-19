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
import { feedback } from '../../lib/feedback.ts';


export function SessionHeader({ session, details, onOpen, onHandoff }: { session: string; details: SessionDetails | undefined; onOpen?: (session: string) => void; onHandoff?(): void }) {
  const { transport, desktop } = usePlatform();
  const [copied, setCopied] = useState(false);
  const [machine, setMachine] = useState('local');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(details?.title ?? '');
  const [renameError, setRenameError] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [forking, setForking] = useState(false);
  const [copying, setCopying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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
    if (renameBusy) return;
    setRenameBusy(true); setRenameError('');
    try {
      const result = await transport.request('session.rename', { session, title: title.trim() });
      if (result.type === 'res') { setRenaming(false); feedback.success('Session renamed'); }
      else { setRenameError(String(result.message ?? result.code)); feedback.error(String(result.message ?? result.code)); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRenameError(message); feedback.error(message);
    } finally { setRenameBusy(false); }
  };
  const exportTranscript = async () => {
    try {
      const result = await transport.request('session.export', { session, format: 'markdown' });
      if (result.type !== 'res') { feedback.error(String(result.message)); return; }
      const text = String(result.body.text ?? '');
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(details?.title || 'session').replace(/[^\w.-]+/g, '-')}.md`; a.click();
      URL.revokeObjectURL(url);
      feedback.success('Transcript saved');
    } catch (error) { feedback.error(error instanceof Error ? error.message : String(error)); }
  };
  const copyPath = async () => {
    if (!details?.cwd) return;
    try { await navigator.clipboard.writeText(details.cwd); feedback.success('Path copied'); }
    catch (error) { feedback.error(error instanceof Error ? error.message : String(error)); }
  };
  const forkLatest = async () => {
    if (forking) return;
    setForking(true);
    try {
      const listed = await transport.request('checkpoint.list', { session });
      if (listed.type !== 'res') { feedback.error(String(listed.message ?? listed.code)); return; }
      const checkpoint = (listed.body.checkpoints as { id: string }[] | undefined)?.[0];
      if (!checkpoint) { feedback.info('No checkpoint to fork from yet'); return; }
      const fork = await transport.request('checkpoint.fork', { session, id: checkpoint.id });
      if (fork.type === 'res' && typeof fork.body.session === 'string') onOpen?.(fork.body.session);
      else feedback.error(String(fork.message ?? fork.code));
    } catch (error) { feedback.error(error instanceof Error ? error.message : String(error)); }
    finally { setForking(false); }
  };
  const deleteScratch = async () => {
    if (deleting) return;
    setDeleting(true); setDeleteError('');
    try {
      const result = await transport.request('session.delete', { session });
      if (result.type === 'res') {
        setConfirmDelete(false);
        feedback.success('Scratch session deleted');
      } else {
        setDeleteError(String(result.message ?? result.code));
        feedback.error(String(result.message ?? result.code));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeleteError(message); feedback.error(message);
    } finally { setDeleting(false); }
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
            }} disabled={renameBusy} style={{ width: 180, minWidth: 0, height: 26, padding: '0 7px', border: '1px solid var(--line-card)', borderRadius: 5, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 12 }} />
            <button disabled={renameBusy || !title.trim()} onClick={() => void rename()} style={{ border: 0, background: 'var(--bg-raised)', color: 'var(--text-active)', borderRadius: 5, padding: '0 7px', cursor: 'pointer' }}>{renameBusy ? 'Saving…' : 'Save'}</button>
          </div> : null}
          {renameError && renaming ? <div role="alert" style={{ padding: '0 8px 5px', width: 240, color: 'var(--accent-red)', fontSize: 11 }}>{renameError}</div> : null}
          {details?.cwd ? <DropdownMenuItem onClick={() => void copyPath()}>Copy path</DropdownMenuItem> : null}
          {details?.cwd && desktop ? <DropdownMenuItem onClick={() => void desktop.openPath(details.cwd!)}>Open worktree folder</DropdownMenuItem> : null}
          {details?.project === 'scratch' ? <DropdownMenuItem onSelect={() => setCopying(true)}>Copy to project…</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => void exportTranscript()}>Export transcript as Markdown</DropdownMenuItem>
          {details?.project !== 'scratch' ? <DropdownMenuItem disabled={forking} onClick={() => void forkLatest()}>{forking ? 'Forking…' : 'Fork from latest checkpoint'}</DropdownMenuItem> : null}
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
            {deleteError ? <div role="alert" style={{ color: 'var(--accent-red)', fontSize: 11, marginBottom: 6 }}>{deleteError}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button disabled={deleting} onClick={() => setConfirmDelete(false)} style={smallButton}>Cancel</button>
              <button disabled={deleting} onClick={() => void deleteScratch()} style={{ ...smallButton, borderColor: 'var(--line-red)', background: 'var(--tint-red)', color: 'var(--accent-red)' }}>{deleting ? 'Deleting…' : 'Delete'}</button>
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
