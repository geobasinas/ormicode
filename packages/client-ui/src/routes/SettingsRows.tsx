/** Shared Settings building blocks: a titled card group and one row in it. */
import type { ReactNode } from 'react';

export const label = { fontSize: 10, fontWeight: 500, color: 'var(--text-label)', letterSpacing: 1 };
export const card = { background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, overflow: 'hidden' as const };
export const ctl = {
  font: 'inherit', fontSize: 11.5, color: 'var(--text-title)', background: 'transparent', border: '1px solid var(--line-card)',
  borderRadius: 7, padding: '0 10px', height: 26, outline: 'none', boxSizing: 'border-box' as const,
};

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ marginTop: 18 }}><div style={{ ...label, margin: '0 0 7px' }}>{title}</div><div style={card}>{children}</div></div>;
}
export function Row({ title, hint, children, mono, monoTitle }: { title: string; hint?: string; children?: ReactNode; mono?: boolean; monoTitle?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '7px 14px', boxSizing: 'border-box', borderTop: '1px solid var(--line-card)', marginTop: -1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-title)', fontFamily: monoTitle ? 'var(--font-mono)' : undefined }}>{title}</div>
        {hint ? <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
