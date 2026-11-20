/**
 * Full-screen web pairing (frames 1c–1e): shown instead of the shell while
 * the browser is `unpaired`. The token is stored by the platform, never here.
 */
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link2, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { Button } from '../../components/Button.tsx';

const digitsOf = (v: string) => v.replace(/\D/g, '').slice(0, 12);
const grouped = (d: string) => d.replace(/(\d{4})(?=\d)/g, '$1 ');

function explain(raw: string): string {
  if (/invalid_code|rejected/.test(raw)) return "That code didn't work. Check the digits, or run ormi pair for a new one.";
  if (/expired/.test(raw)) return 'That code has expired. Run ormi pair on your hub for a new one.';
  if (/rate|429/.test(raw)) return 'Too many tries. Wait a minute, then try again.';
  if (/offline/.test(raw)) return 'Your hub is offline. Start it, then try again.';
  if (/fetch|network/i.test(raw)) return "Can't reach the relay. Check your connection.";
  return 'Pairing failed.';
}

const label: CSSProperties = { display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-secondary)' };
const input: CSSProperties = {
  font: 'inherit', fontSize: 14, height: 38, padding: '0 12px', width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-inset)', color: 'var(--text-active)', outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 8,
};

export function PairScreen({ pairPrefill }: { pairPrefill?: { account?: string; code?: string } }) {
  const web = usePlatform().web!;
  const [account, setAccount] = useState(pairPrefill?.account ?? '');
  const [code, setCode] = useState(digitsOf(pairPrefill?.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (pairPrefill?.account) setAccount(pairPrefill.account);
    if (pairPrefill?.code) setCode(digitsOf(pairPrefill.code));
  }, [pairPrefill?.account, pairPrefill?.code]);
  const fromLink = Boolean(pairPrefill?.code) && code === digitsOf(pairPrefill?.code ?? '');
  const ready = account.trim() !== '' && code.length === 12 && !busy;
  let relayHost = web.relayUrl;
  try { relayHost = new URL(web.relayUrl).host; } catch { /* keep raw */ }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError(undefined);
    try { await web.pair({ account: account.trim(), code }); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setBusy(false); }
  };

  return (
    <main style={{
      minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 18, padding: '40px 20px', background: 'radial-gradient(ellipse at 50% 0%, var(--bg-card) 0%, var(--bg-window) 60%)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div aria-hidden style={{
          width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: 'var(--text-title)', color: 'var(--text-onAccent)', fontWeight: 700, fontSize: 15,
        }}>o</div>
        <span style={{ color: 'var(--text-title)', fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>ormicode</span>
      </div>

      <form onSubmit={e => void submit(e)} style={{
        width: '100%', maxWidth: 400, boxSizing: 'border-box', display: 'grid', gap: 18, padding: 28,
        background: 'var(--bg-main)', border: '1px solid var(--line-card)', borderRadius: 14,
        boxShadow: '0 24px 60px var(--shadow-color)',
      }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-title)', letterSpacing: -0.3 }}>Pair this browser</h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            Connect to your hub to watch and steer your sessions from here.
          </p>
        </div>

        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {[<>On your hub, run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-active)', background: 'var(--bg-chip)', padding: '1px 6px', borderRadius: 4 }}>ormi pair</code></>,
            <>Enter the account and the 12-digit code it shows</>].map((step, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-label)' }}>
              <span style={{
                width: 20, height: 20, flexShrink: 0, borderRadius: 10, display: 'grid', placeItems: 'center',
                background: 'var(--bg-chip)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
              }}>{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div style={{ display: 'grid', gap: 14 }}>
          <label style={label}>
            Account
            <input value={account} onChange={e => setAccount(e.target.value)} placeholder="e.g. studio"
              autoComplete="off" autoCapitalize="off" spellCheck={false} style={input} />
          </label>
          <label style={label}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Pairing code<span style={{ color: code.length === 12 ? 'var(--accent-mint)' : 'var(--text-hint)', fontVariantNumeric: 'tabular-nums' }}>{code.length}/12</span>
            </span>
            <input value={grouped(code)} onChange={e => { setCode(digitsOf(e.target.value)); setError(undefined); }}
              placeholder="0000 0000 0000" aria-label="Pairing code" inputMode="numeric" autoComplete="one-time-code" autoFocus={!code}
              style={{ ...input, height: 48, fontFamily: 'var(--font-mono)', fontSize: 22, letterSpacing: 3, textAlign: 'center',
                borderColor: error ? 'var(--accent-red)' : 'var(--line-card)' }} />
          </label>
          {fromLink ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent-mint)' }}>
              <Link2 size={13} /> Filled in from your pairing link
            </div>
          ) : null}
          {error ? (
            <div role="alert" style={{
              display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45,
              color: 'var(--accent-red)', background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
            }}>
              <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ display: 'grid', gap: 2 }}>
                <span>{explain(error)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.75 }}>{error}</span>
              </div>
            </div>
          ) : null}
        </div>

        <Button type="submit" variant="primary" disabled={!ready} style={{ width: '100%', height: 38, fontSize: 13.5 }}>
          {busy ? <><LoaderCircle size={15} className="animate-spin" /> Pairing…</> : 'Pair'}
        </Button>
      </form>

      <div style={{ display: 'grid', gap: 6, justifyItems: 'center', fontSize: 12, color: 'var(--text-hint)', textAlign: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={13} /> Codes work once and expire after 10 minutes.
        </span>
        <span>Relay · <span style={{ fontFamily: 'var(--font-mono)' }}>{relayHost}</span></span>
      </div>
    </main>
  );
}
