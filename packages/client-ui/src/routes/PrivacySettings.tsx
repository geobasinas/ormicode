/** Settings → Data and privacy: where data lives, export it as a tar, or wipe it after typing a word. */
import { useState } from 'react';
import type { Frame } from '@ormicode/protocol';
import { usePlatform } from '../lib/platform.ts';
import { Group, Row, ctl } from './SettingsRows.tsx';

export const WIPE_WORD = 'wipe';
const button = { ...ctl, cursor: 'pointer', fontSize: 11 } as const;
const danger = { ...button, color: 'var(--accent-red)', borderColor: 'var(--accent-red)' } as const;
const note = { padding: '0 14px 9px', fontSize: 11, lineHeight: 1.5 } as const;

function failure(response: Frame): string {
  return response.type === 'err' ? `${response.code}: ${response.message}` : 'unexpected reply';
}

function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportRow({ disabled }: { disabled: boolean }) {
  const { transport } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const run = async () => {
    setBusy(true); setStatus(undefined);
    try {
      const started = await transport.request('data.export', {});
      if (started.type !== 'res') throw new Error(failure(started));
      const { handle, name } = started.body as { handle: string; name: string };
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let offset = 0; ;) {
        const chunk = await transport.request('data.exportChunk', { handle, offset });
        if (chunk.type !== 'res') throw new Error(failure(chunk));
        const { data, done } = chunk.body as { data: string; done: boolean };
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        parts.push(bytes); offset += bytes.length;
        if (done) break;
      }
      saveFile(name, new Blob(parts, { type: 'application/x-tar' }));
      setStatus({ ok: true, text: `Saved ${name}` });
    } catch (cause) { setStatus({ ok: false, text: cause instanceof Error ? cause.message : String(cause) }); }
    finally { setBusy(false); }
  };
  return <>
    <Row title="Export" hint="A .tar of the store, config.json and the daemon log. No tokens, keys or session logs.">
      <button style={button} disabled={disabled || busy} onClick={() => void run()}>{busy ? 'Exporting…' : 'Export'}</button>
    </Row>
    {status ? <div role={status.ok ? 'status' : 'alert'} style={{ ...note, color: status.ok ? 'var(--text-secondary)' : 'var(--accent-red)' }}>{status.text}</div> : null}
  </>;
}

function DeleteRow({ disabled, onWiped }: { disabled: boolean; onWiped(removed: string[]): void }) {
  const { transport } = usePlatform();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim() === WIPE_WORD;
  const cancel = () => { setOpen(false); setTyped(''); setError(''); };
  const wipe = async () => {
    if (!matches || busy) return;
    setBusy(true); setError('');
    try {
      const r = await transport.request('data.wipe', { confirm: typed.trim() });
      if (r.type === 'res') onWiped((r.body as { removed: string[] }).removed);
      else setError(failure(r));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <Row title="Delete local data" hint="Stops the hub, then deletes the store, logs, cache and keys on this computer.">
      {open ? null : <button style={danger} disabled={disabled} onClick={() => setOpen(true)}>Delete…</button>}
    </Row>
    {open ? <div style={{ padding: '2px 14px 12px', fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      <div>This can’t be undone. Sessions, journals, notes, checkpoints, logs, cache, the hub token and device tokens are deleted, and paired devices must pair again.
        Kept: config.json, scratch folders, skills, teams, automations and secrets in your keyring. Export first if you want a copy.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <label htmlFor="ormi-wipe-confirm">Type <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-title)' }}>{WIPE_WORD}</b> to confirm</label>
        <input id="ormi-wipe-confirm" aria-label={`Type ${WIPE_WORD} to confirm`} autoComplete="off" spellCheck={false} autoFocus value={typed}
          onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') cancel(); }} disabled={busy}
          style={{ ...ctl, width: 110, fontFamily: 'var(--font-mono)' }} />
        <button style={matches ? danger : button} disabled={!matches || busy} onClick={() => void wipe()}>{busy ? 'Deleting…' : 'Delete everything permanently'}</button>
        <button style={button} disabled={busy} onClick={cancel}>Cancel</button>
      </div>
      {error ? <div role="alert" style={{ marginTop: 6, color: 'var(--accent-red)' }}>{error}</div> : null}
    </div> : null}
  </>;
}

export function PrivacySettings() {
  const { web } = usePlatform();
  const [wiped, setWiped] = useState<string[]>();
  const remoteHint = web ? 'Only on the hub’s own computer' : undefined;
  return <>
    {wiped ? <Group title="LOCAL DATA">
      <Row title="Local data deleted" hint={`Removed ${wiped.join(', ') || 'nothing (already empty)'}.`} />
      <div role="status" style={{ ...note, color: 'var(--text-secondary)' }}>The hub has stopped. Start it again with <code>ormi daemon</code> to begin with an empty hub.</div>
    </Group> : <Group title="YOUR DATA">
      {remoteHint ? <Row title="Export and delete" hint={remoteHint} /> : null}
      <ExportRow disabled={Boolean(web)} />
      <DeleteRow disabled={Boolean(web)} onWiped={setWiped} />
    </Group>}
  </>;
}
