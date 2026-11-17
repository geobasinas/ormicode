/** Minimal button primitive — themed via CSS vars. Real component
 * primitives (shadcn vendored set) land in components/ui/ later. */
import type { ButtonHTMLAttributes } from 'react';

export function Button({ variant, style, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const colors = variant === 'danger'
    ? { background: 'var(--tint-red)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }
    : variant === 'primary'
      ? { background: 'var(--accent-mint)', color: 'var(--text-onAccent)', border: '1px solid transparent' }
      : { background: 'transparent', color: 'var(--text-label)', border: '1px solid var(--line-card)' };
  return <button {...rest} style={{
    font: 'inherit', fontSize: 'var(--text-sm)', padding: '4px 10px',
    borderRadius: 'var(--radius-sm)', cursor: 'pointer', ...colors, ...style,
  }} />;
}
