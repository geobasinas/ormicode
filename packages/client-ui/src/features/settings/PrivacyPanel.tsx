/** Settings → Data and privacy: export the hub's data as a tar, or wipe it after typing a word. */
import { useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { Button } from '../../components/Button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Group, Message, Page, Row, failure } from './parts.tsx';

export const WIPE_WORD = 'wipe';

function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportRow({ disabled }: { disabled: boolean }) {
  const { transport } = usePlatform();
  const [progress, setProgress] = useState<number>();
  const run = async () => {
    setProgress(0);
    try {
      const started = await transport.request('data.export', {});
      if (started.type !== 'res') throw new Error(failure(started));
      const { handle, name, size } = started.body as { handle: string; name: string; size: number };
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let offset = 0; ;) {
        const chunk = await transport.request('data.exportChunk', { handle, offset });
        if (chunk.type !== 'res') throw new Error(failure(chunk));
        const { data, done } = chunk.body as { data: string; done: boolean };
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        parts.push(bytes); offset += bytes.length;
        setProgress(size ? offset / size : 0);
        if (done) break;
      }
      saveFile(name, new Blob(parts, { type: 'application/x-tar' }));
      feedback.success(`Saved ${name}`);
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); }
    finally { setProgress(undefined); }
  };
  return <Row title="Export your data" hint="A .tar with the store, config.json and the daemon log. No tokens, keys or raw session logs.">
    <Button disabled={disabled || progress !== undefined} onClick={() => void run()}>{progress !== undefined ? `Exporting ${Math.round(progress * 100)}%` : 'Export'}</Button>
  </Row>;
}

function WipeRow({ disabled, onWiped }: { disabled: boolean; onWiped(removed: string[]): void }) {
  const { transport } = usePlatform();
  const [typed, setTyped] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const matches = typed?.trim() === WIPE_WORD;
  const cancel = () => { setTyped(undefined); setError(undefined); };
  const wipe = async () => {
    if (!matches || busy) return;
    setBusy(true); setError(undefined);
    try {
      const r = await transport.request('data.wipe', { confirm: WIPE_WORD });
      if (r.type === 'res') onWiped((r.body as { removed: string[] }).removed); else setError(failure(r));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Row title="Delete local data" hint="Stops the hub, then deletes its store, logs, cache and tokens on this computer."
    below={typed !== undefined ? <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--tint-red)', border: '1px solid var(--line-red)', fontSize: 12, lineHeight: 1.55, color: 'var(--text-label)' }}>
      <div>This can't be undone. Sessions, journals, notes, checkpoints, logs, the hub token and device tokens are deleted, and every paired device has to pair again.
        Kept: config.json, scratch folders, skills, teams, automations and secrets in your keyring. Export first if you want a copy.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <label htmlFor="ormi-wipe-confirm">Type <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-title)' }}>{WIPE_WORD}</b> to confirm</label>
        <Input id="ormi-wipe-confirm" autoComplete="off" spellCheck={false} autoFocus value={typed} disabled={busy}
          onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') cancel(); if (e.key === 'Enter') void wipe(); }}
          style={{ width: 100, height: 30, fontFamily: 'var(--font-mono)', background: 'var(--bg-inset)' }} />
        <Button variant="danger" disabled={!matches || busy} onClick={() => void wipe()}>{busy ? 'Deleting…' : 'Delete everything'}</Button>
        <Button variant="ghost" disabled={busy} onClick={cancel}>Cancel</Button>
      </div>
      {error ? <div role="alert" style={{ marginTop: 8, color: 'var(--accent-red)' }}>{error}</div> : null}
    </div> : null}>
    {typed === undefined ? <Button variant="danger" disabled={disabled} onClick={() => setTyped('')}>Delete…</Button> : null}
  </Row>;
}

export function PrivacyPanel({ connection }: { connection: string }) {
  const platform = usePlatform();
  const [wiped, setWiped] = useState<string[]>();
  const remote = Boolean(platform.web) || platform.desktop?.linkIsLocal() === false;
  const disabled = remote || connection !== 'online';
  return <Page title="Data and privacy" subtitle="Everything the hub stores lives in ~/.ormicode on its own computer">
    {wiped ? <Group title="Local data">
      <Row title="Local data deleted" hint={`Removed ${wiped.join(', ') || 'nothing (already empty)'}.`} />
      <Message tone="info">The hub has stopped. Start it again with <code>ormi daemon</code> to begin with an empty hub.</Message>
    </Group> : <Group title="Your data">
      {remote ? <Message tone="info">Export and delete only work from the hub's own computer, so data never crosses the relay.</Message> : null}
      <ExportRow disabled={disabled} />
      <WipeRow disabled={disabled} onWiped={setWiped} />
    </Group>}
    <Group title="What leaves this computer">
      <Row title="Telemetry" hint="ormicode sends no telemetry or analytics."><span style={{ fontSize: 12, color: 'var(--text-label)' }}>None</span></Row>
      <Row title="Model prices" hint="Cost estimates fetch public prices from OpenRouter once a day. No usage is sent." />
      <Row title="Relay" hint="Paired devices reach the hub through the relay over TLS. There is no extra encryption on top, so the relay can read session traffic and the history it keeps for catch-up (30 days)." />
    </Group>
  </Page>;
}
