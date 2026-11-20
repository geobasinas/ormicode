/**
 * Pairing card: shown on Now when the shell reports `unpaired`.
 * Sends relay/account/code to the shell's pair() — the token never
 * touches the renderer.
 */
import { useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { Button } from '../../components/Button.tsx';

export function PairCard({ pairPrefill }: { pairPrefill?: { account?: string; code?: string } }) {
  const platform = usePlatform();
  const [relay, setRelay] = useState('https://relay.ormi.codes');
  const [account, setAccount] = useState(pairPrefill?.account ?? '');
  const [code, setCode] = useState(pairPrefill?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const web = platform.web;
  useEffect(() => {
    if (pairPrefill?.account) setAccount(pairPrefill.account);
    if (pairPrefill?.code) setCode(pairPrefill.code);
  }, [pairPrefill?.account, pairPrefill?.code]);
  if (!platform.desktop && !web) return null;

  const field = (v: string, set: (s: string) => void, ph: string) => (
    <input value={v} onChange={e => set(e.target.value)} placeholder={ph} style={{
      font: 'inherit', fontSize: 'var(--text-sm)', padding: '6px var(--space-3)', width: '100%',
      background: 'var(--bg-main)', color: 'var(--text-active)',
      border: '1px solid var(--line-card)', borderRadius: 'var(--radius-sm)',
    }} />
  );

  const pair = async () => {
    setBusy(true); setError(undefined);
    try {
      if (web) await web.pair({ account, code: code.replace(/\s/g, '') });
      else await platform.desktop!.pair({ relay, account, code: code.replace(/\s/g, ''), name: 'desktop' });
      setBusy(false);
    }
    catch (e) { setError(String(e)); setBusy(false); }
  };

  return (
    <div style={{
      padding: 'var(--space-3)', marginBottom: 'var(--space-4)',
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 'var(--radius-md)',
      display: 'grid', gap: 'var(--space-2)', maxWidth: 420,
    }}>
      <div style={{ color: 'var(--text-active)', fontSize: 'var(--text-sm)' }}>pair this {web ? 'browser' : 'device'}</div>
      <div style={{ color: 'var(--text-hint)', fontSize: 'var(--text-xs)' }}>
        {web ? `Relay: ${web.relayUrl}` : 'no local daemon found — pair with a remote hub using the code from `ormi pair`'}
      </div>
      {!web ? field(relay, setRelay, 'relay url') : null}
      {field(account, setAccount, 'account')}
      {field(code, setCode, 'pairing code (xxxx xxxx xxxx)')}
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)' }}>{error}</div> : null}
      <div><Button onClick={() => void pair()} disabled={busy || !account || !code}>{busy ? 'pairing…' : 'pair'}</Button></div>
    </div>
  );
}
