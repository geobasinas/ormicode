/** Shared button — thin variant map over the vendored shadcn button in
 * components/ui/. Feature code uses this, never the ui/ path directly,
 * so restyles land in one place. */
import type { ButtonHTMLAttributes } from 'react';
import { Button as ShButton } from './ui/button.tsx';

export function Button({ variant, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = variant === 'danger' ? 'destructive' : variant === 'primary' ? 'default' : 'outline';
  return <ShButton variant={v} size="sm" {...rest} />;
}
