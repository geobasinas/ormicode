/** React context carrying the shell's ClientPlatform into every feature. */
import { createContext, useContext } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';

export const PlatformContext = createContext<ClientPlatform | undefined>(undefined);

export function usePlatform(): ClientPlatform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('usePlatform outside a PlatformContext provider');
  return p;
}
