import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { BrowserServiceState } from './browser-types.ts';

type BrowserIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & { title: string };

export const BrowserIconButton = forwardRef<HTMLButtonElement, BrowserIconButtonProps>(
  function BrowserIconButton({ title, disabled, children, className, style, ...props }, ref) {
    return <button ref={ref} type="button" title={title} aria-label={title} disabled={disabled} {...props}
      className={disabled ? className : `hv ${className ?? ''}`} style={{
        width: 26, height: 26, flexShrink: 0, border: 0, borderRadius: 6,
        background: 'transparent', color: disabled ? 'var(--text-hint)' : 'var(--text-secondary)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, cursor: disabled ? 'default' : 'pointer', ...style,
      }}>{children}</button>;
  },
);

export function ServiceStatusDot({ state, size = 7 }: { state: BrowserServiceState | string; size?: number }) {
  const color = state === 'running' ? 'var(--accent-mint)'
    : state === 'starting' || state === 'unhealthy' ? 'var(--accent-amber)'
      : state === 'exited' ? 'var(--accent-red)' : 'var(--text-hint)';
  return <span aria-label={state} title={state} style={{
    width: size, height: size, flexShrink: 0, borderRadius: '50%', background: color,
    boxShadow: state === 'running' ? '0 0 0 2px var(--tint-mint)' : undefined,
  }} />;
}

export const browserPrimaryButton = {
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px',
  border: 0, borderRadius: 7, background: 'var(--text-title)', color: 'var(--text-onAccent)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
} as const;
