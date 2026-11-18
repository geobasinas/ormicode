/** Shared Git pane pieces styled after the Desktop — Git mockups. */
import type { CSSProperties, ReactNode } from 'react';

export const mono: CSSProperties = { fontFamily: 'var(--font-mono)' };
export const hint: CSSProperties = { color: 'var(--text-hint)', fontSize: 11 };
export const card: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10 };

export function Count({ children, mint }: { children: ReactNode; mint?: boolean }) {
  return <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--bg-chip)', color: mint ? 'var(--accent-mint)' : 'var(--text-hint)' }}>{children}</span>;
}

export function Stat({ added, removed }: { added: number; removed: number }) {
  return <span style={{ ...mono, fontSize: 11, display: 'inline-flex', gap: 6 }}>
    {added ? <span style={{ color: 'var(--accent-mint)' }}>+{added}</span> : null}
    {removed ? <span style={{ color: 'var(--accent-red)' }}>-{removed}</span> : null}
  </span>;
}

const STATUS_COLOR: Record<string, string> = { M: 'var(--accent-amber)', modified: 'var(--accent-amber)', A: 'var(--accent-mint)', added: 'var(--accent-mint)', '?': 'var(--accent-mint)', D: 'var(--accent-red)', deleted: 'var(--accent-red)', R: 'var(--text-secondary)', renamed: 'var(--text-secondary)', U: 'var(--accent-red)' };
const LETTER: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', '?': 'A' };

export function FileRow({ path, status, added, removed, active, onClick }: { path: string; status: string; added: number; removed: number; active?: boolean; onClick?: () => void }) {
  const i = path.lastIndexOf('/');
  return (
    <div onClick={onClick} className={onClick && !active ? 'hv' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 6, cursor: onClick ? 'pointer' : 'default', background: active ? 'var(--bg-raised)' : 'transparent', fontSize: 12 }}>
      <span style={{ ...mono, fontSize: 10, width: 10, color: STATUS_COLOR[status] ?? 'var(--text-hint)' }}>{LETTER[status] ?? status}</span>
      <span style={{ color: 'var(--text-title)', whiteSpace: 'nowrap' }}>{path.slice(i + 1)}</span>
      <span style={{ ...hint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{i > 0 ? path.slice(0, i) : ''}</span>
      <Stat added={added} removed={removed} />
    </div>
  );
}

export function Header({ title, count, children }: { title: string; count?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 40, flexShrink: 0, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-title)' }}>{title}</span>
      {count !== undefined ? <Count>{count}</Count> : null}
      <span style={{ flex: 1 }} />{children}
    </div>
  );
}

export function Btn({ children, onClick, primary, danger, disabled, title }: { children: ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={disabled || primary ? undefined : 'hv'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 7, font: 'inherit', fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
      border: primary ? 'none' : danger ? 'none' : '1px solid var(--line-card)',
      background: primary ? '#f2f2f2' : danger ? 'transparent' : 'var(--bg-card)',
      color: primary ? '#101010' : danger ? 'var(--accent-red)' : 'var(--text-label)', fontWeight: primary ? 600 : 400,
    }}>{children}</button>
  );
}

export function IconBtn({ children, onClick, title, disabled }: { children: ReactNode; onClick?: () => void; title: string; disabled?: boolean }) {
  return <button title={title} onClick={disabled ? undefined : onClick} className={disabled ? undefined : 'hv'} style={{ border: 'none', background: 'transparent', color: 'var(--text-hint)', display: 'inline-flex', padding: 4, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}>{children}</button>;
}

export function Footer({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--line-subtle)', flexShrink: 0 }}>{children}</div>;
}

export function Notice({ children, tone = 'hint' }: { children: ReactNode; tone?: 'hint' | 'red' | 'amber' }) {
  const color = tone === 'red' ? 'var(--accent-red)' : tone === 'amber' ? 'var(--accent-amber)' : 'var(--text-hint)';
  return <div style={{ padding: '8px 12px', fontSize: 11.5, color }}>{children}</div>;
}

export function Section({ children }: { children: ReactNode }) {
  return <div style={{ ...mono, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-hint)', padding: '12px 12px 4px' }}>{children}</div>;
}

export const scroll: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto' };
