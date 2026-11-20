/**
 * Web pairing dialog: sits over the shell while the browser is `unpaired`.
 * The token is stored by the platform, never here.
 */
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { Button } from '../../components/Button.tsx';

const digitsOf = (v: string) => v.replace(/\D/g, '').slice(0, 12);
const grouped = (d: string) => d.replace(/(\d{4})(?=\d)/g, '$1 ');

function explain(raw: string): string {
  if (/invalid_code|rejected/.test(raw)) return "That code didn't work.";
  if (/expired/.test(raw)) return 'That code has expired.';
  if (/rate|429/.test(raw)) return 'Too many tries. Wait a minute.';
  if (/offline/.test(raw)) return 'Your hub is offline.';
  if (/fetch|network/i.test(raw)) return "Can't reach the relay.";
  return 'Pairing failed.';
}

const input: CSSProperties = {
  font: 'inherit', fontSize: 14, height: 38, padding: '0 12px', width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-inset)', color: 'var(--text-active)', outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 8,
};

export function PairDialog({ pairPrefill }: { pairPrefill?: { account?: string; code?: string } }) {
  const web = usePlatform().web!;
  const [account, setAccount] = useState(pairPrefill?.account ?? '');
  const [code, setCode] = useState(digitsOf(pairPrefill?.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (pairPrefill?.account) setAccount(pairPrefill.account);
    if (pairPrefill?.code) setCode(digitsOf(pairPrefill.code));
  }, [pairPrefill?.account, pairPrefill?.code]);
  const ready = account.trim() !== '' && code.length === 12 && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError(undefined);
    try { await web.pair({ account: account.trim(), code }); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 20,
      background: 'var(--bg-scrim)',
    }}>
      <form role="dialog" aria-modal="true" aria-labelledby="pair-title" onSubmit={e => void submit(e)} style={{
        width: '100%', maxWidth: 340, boxSizing: 'border-box', display: 'grid', gap: 12, padding: 24,
        background: 'var(--bg-main)', border: '1px solid var(--line-card)', borderRadius: 14,
        boxShadow: '0 24px 60px var(--shadow-color)',
      }}>
        <div style={{ display: 'grid', gap: 4, marginBottom: 4 }}>
          <h1 id="pair-title" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-title)' }}>Pair this browser</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-hint)' }}>
            Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>ormi pair</code> on your hub.
          </p>
        </div>
        <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account" aria-label="Account"
          autoComplete="off" autoCapitalize="off" spellCheck={false} style={input} />
        <input value={grouped(code)} onChange={e => { setCode(digitsOf(e.target.value)); setError(undefined); }}
          placeholder="0000 0000 0000" aria-label="Pairing code" inputMode="numeric" autoComplete="one-time-code" autoFocus={!code}
          style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: 2, textAlign: 'center',
            borderColor: error ? 'var(--accent-red)' : 'var(--line-card)' }} />
        {error ? <div role="alert" title={error} style={{ fontSize: 12, color: 'var(--accent-red)' }}>{explain(error)}</div> : null}
        <Button type="submit" variant="primary" disabled={!ready} style={{ width: '100%', height: 36, marginTop: 4 }}>
          {busy ? 'Pairing…' : 'Pair'}
        </Button>
      </form>
    </div>
  );
}
