/** Cross-platform onboarding for pairing a client with its hub. */
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
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
  font: 'inherit', fontSize: 14, height: 40, padding: '0 12px', width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-card)', color: 'var(--text-active)', outline: 'none',
  border: '1px solid var(--line-card)', borderRadius: 8,
};
const title: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-title)', letterSpacing: -0.3 };
const sub: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' };
const mono: CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--text-active)' };

type Step = 'welcome' | 'code' | 'connecting';

export function Onboarding({ state, pairPrefill, onSkip, onOpenSettings }: {
  state: string; pairPrefill?: { account?: string; code?: string }; onSkip?: () => void; onOpenSettings?: () => void;
}) {
  const platform = usePlatform();
  const desktop = Boolean(platform.desktop);
  const [step, setStep] = useState<Step>(pairPrefill?.code ? 'code' : 'welcome');
  const [relay, setRelay] = useState('https://relay.ormi.codes');
  const [changeRelay, setChangeRelay] = useState(false);
  const [account, setAccount] = useState(pairPrefill?.account ?? '');
  const [code, setCode] = useState(digitsOf(pairPrefill?.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [sawConnecting, setSawConnecting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (pairPrefill?.account) setAccount(pairPrefill.account);
    if (pairPrefill?.code) { setCode(digitsOf(pairPrefill.code)); setStep('code'); }
  }, [pairPrefill?.account, pairPrefill?.code]);
  useEffect(() => {
    if (step !== 'connecting') return;
    if (state === 'connecting') setSawConnecting(true);
    else if (state === 'unpaired' && sawConnecting) { setSawConnecting(false); setStep('welcome'); }
  }, [state, step, sawConnecting]);
  const ready = account.trim() !== '' && code.length === 12 && !busy && (!desktop || relay.trim() !== '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError(undefined); setSawConnecting(false);
    try {
      if (platform.web) await platform.web.pair({ account: account.trim(), code });
      else await platform.desktop!.pair({ relay: relay.trim(), account: account.trim(), code, name: 'desktop' });
      setStep('connecting');
    }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setBusy(false); }
  };

  let body: ReactNode;
  if (step === 'welcome') body = <>
    <h1 style={title}>Welcome to ormicode</h1>
    <p style={sub}>Connect this {desktop ? 'app' : 'browser'} to your hub to see and steer your sessions.</p>
    {desktop ? <p style={sub}>Or start the daemon on this machine with <code style={mono}>ormi daemon</code>.</p> : null}
    <Button variant="primary" onClick={() => setStep('code')} style={{ width: '100%', height: 40, marginTop: 10 }}>Get started</Button>
    {desktop && onSkip ? <Button variant="ghost" onClick={onSkip} style={{ width: '100%' }}>Skip for now</Button> : null}
  </>;
  else if (step === 'code') body = <form onSubmit={e => void submit(e)} style={{ display: 'grid', gap: 12 }}>
    <button type="button" onClick={() => { setStep('welcome'); setError(undefined); }} aria-label="Back" style={{
      justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 6,
      font: 'inherit', fontSize: 12.5, color: 'var(--text-hint)', background: 'none', border: 'none', cursor: 'pointer',
    }}><ArrowLeft size={14} /> Back</button>
    <h1 style={title}>Pair this {desktop ? 'app' : 'browser'}</h1>
    <p style={{ ...sub, marginBottom: 6 }}>Run <code style={mono}>ormi pair</code> on your hub and enter what it shows.</p>
    {desktop ? <>
      <button type="button" onClick={() => setChangeRelay(value => !value)} style={{
        justifySelf: 'start', padding: 0, font: 'inherit', fontSize: 11, color: 'var(--text-hint)',
        background: 'none', border: 'none', cursor: 'pointer',
      }}>{changeRelay ? 'Use default relay' : 'Change relay'}</button>
      {changeRelay ? <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>Relay URL
        <input value={relay} onChange={e => setRelay(e.target.value)} aria-label="Relay URL" autoComplete="url" style={input} />
      </label> : null}
    </> : null}
    <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account" aria-label="Account"
      autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus={!account} style={input} />
    <input value={grouped(code)} onChange={e => { setCode(digitsOf(e.target.value)); setError(undefined); }}
      placeholder="0000 0000 0000" aria-label="Pairing code" inputMode="numeric" autoComplete="one-time-code" autoFocus={Boolean(account) && !code}
      style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: 2, textAlign: 'center',
        borderColor: error ? 'var(--accent-red)' : 'var(--line-card)' }} />
    {error ? <div role="alert" title={error} style={{ fontSize: 12, color: 'var(--accent-red)' }}>{explain(error)}</div> : null}
    <Button type="submit" variant="primary" disabled={!ready} style={{ width: '100%', height: 40, marginTop: 4 }}>
      {busy ? 'Pairing…' : 'Pair'}
    </Button>
    {desktop && onSkip ? <Button type="button" variant="ghost" onClick={onSkip} style={{ width: '100%' }}>Skip for now</Button> : null}
  </form>;
  else body = <>
    <LoaderCircle size={28} className="animate-spin" style={{ color: 'var(--text-secondary)', marginBottom: 6 }} />
    <h1 style={title}>{state === 'offline' ? 'Waiting for your hub' : 'Connecting'}</h1>
    <p style={sub}>{state === 'offline' ? 'Make sure the hub is running. This page connects as soon as it is.'
      : <>Reaching <span style={mono}>{account || 'your hub'}</span> through the relay…</>}</p>
  </>;

  const index = ['welcome', 'code', 'connecting'].indexOf(step);
  return (
    <div style={{ minHeight: '100%', boxSizing: 'border-box', display: 'grid', placeItems: 'center', padding: '40px 20px' }}>
      <div style={{ width: '100%', maxWidth: 320, display: 'grid', gap: 28 }}>
        <div style={{ display: 'grid', gap: 8, justifyItems: step === 'code' ? 'stretch' : 'center', textAlign: step === 'code' ? 'left' : 'center' }}>{body}</div>
        <div aria-hidden style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
          {[0, 1, 2].map(i => <span key={i} style={{
            width: i === index ? 18 : 6, height: 6, borderRadius: 3, transition: 'width 160ms',
            background: i === index ? 'var(--text-secondary)' : 'var(--bg-raised)',
          }} />)}
        </div>
        {onOpenSettings ? <button type="button" className="hv-sub" onClick={onOpenSettings} style={{
          justifySelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', font: 'inherit', fontSize: 12, color: 'var(--text-hint)',
          background: 'none', border: 'none', borderRadius: 7, cursor: 'pointer',
        }}>Settings</button> : null}
      </div>
    </div>
  );
}
