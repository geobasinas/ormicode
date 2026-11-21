/** Settings building blocks: page header, titled card groups, rows and themed controls. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Frame } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { Switch } from '../../components/ui/switch.tsx';

export function failure(frame: Frame): string {
  return frame.type === 'err' ? frame.message || frame.code : 'Unexpected reply from the hub';
}

/** One protocol request, re-run when `deps` change; `reload` re-fetches on demand. */
export function useHub<T>(method: string, body: Record<string, unknown> = {}, enabled = true) {
  const { transport } = usePlatform();
  const key = JSON.stringify(body);
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: enabled });
  const reload = useCallback(async () => {
    if (!enabled) return;
    setState(s => ({ ...s, loading: true }));
    try {
      const r = await transport.request(method, JSON.parse(key) as Record<string, unknown>);
      setState(r.type === 'res' ? { data: r.body as T, loading: false } : { error: failure(r), loading: false });
    } catch (e) { setState({ error: e instanceof Error ? e.message : String(e), loading: false }); }
  }, [transport, method, key, enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

export function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <>
    <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-title)', letterSpacing: -0.2 }}>{title}</h1>
    <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>{subtitle}</p>
    {children}
  </>;
}

export function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section style={{ marginTop: 16 }} aria-label={title}>
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 18, margin: '0 2px 6px' }}>
      <h2 style={{ margin: 0, flex: 1, fontSize: 10.5, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-label)' }}>{title}</h2>
      {action}
    </div>
    <div className="ormi-settings-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, overflow: 'hidden' }}>{children}</div>
  </section>;
}

export function Row({ title, hint, mono, children, below }: { title: ReactNode; hint?: ReactNode; mono?: boolean; children?: ReactNode; below?: ReactNode }) {
  return <div className="ormi-settings-row" style={{ padding: '6px 14px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 30 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-title)', overflowWrap: 'anywhere' }}>{title}</div>
        {hint ? <div style={{ fontSize: 11.5, lineHeight: 1.35, color: 'var(--text-secondary)', marginTop: 1, fontFamily: mono ? 'var(--font-mono)' : undefined, overflowWrap: 'anywhere' }}>{hint}</div> : null}
      </div>
      {children ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div> : null}
    </div>
    {below}
  </div>;
}

/** A row's value on the right: quiet text, mono for ids and paths. */
export function Value({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span style={{ fontSize: 12, color: 'var(--text-label)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right' }}>{children}</span>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean }) {
  return <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange}
    className="data-[state=checked]:bg-[var(--accent-mint)] data-[state=unchecked]:bg-[var(--bg-chip)]" />;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange(value: T): void; label: string }) {
  return <span role="radiogroup" aria-label={label} style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--line-divider)' }}>
    {options.map(([id, name]) => {
      const on = id === value;
      return <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onChange(id)} className={on ? undefined : 'hv-sub'} style={{
        height: 24, padding: '0 12px', border: 'none', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 12,
        background: on ? 'var(--bg-raised)' : 'transparent', color: on ? 'var(--text-title)' : 'var(--text-secondary)',
        boxShadow: on ? '0 1px 2px var(--shadow-color)' : 'none',
      }}>{name}</button>;
    })}
  </span>;
}

type Tone = 'error' | 'warn' | 'ok' | 'muted';
const TONES: Record<Tone, string> = { error: 'var(--accent-red)', warn: 'var(--accent-amber)', ok: 'var(--accent-mint)', muted: 'var(--text-hint)' };

/** State text with a dot, so colour never carries the meaning alone. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-label)' }}>
    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: TONES[tone] }} />{children}
  </span>;
}

export function Message({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} style={{ padding: '10px 16px', fontSize: 12, lineHeight: 1.5, color: tone === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)' }}>{children}</div>;
}

export const mono = { fontFamily: 'var(--font-mono)' } as const;
