import { createRoot } from 'react-dom/client';
import { App } from '@ormicode/client-ui';
import { browserPlatform } from '@ormicode/client-platform';
import { bindBrowserLifecycle } from './lifecycle.ts';
import '@ormicode/client-ui/index.css';
import './theme.css';

declare const __ORMI_VERSION__: string;
declare const __ORMI_COMMIT__: string;
declare const __ORMI_RELAY__: string;

let pairPrefill: { account?: string; code?: string } | undefined;
if (location.pathname === '/pair') {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const account = fragment.get('a') ?? undefined;
  const candidate = fragment.get('c') ?? undefined;
  pairPrefill = { account, code: candidate && /^\d+$/.test(candidate) ? candidate : undefined };
  history.replaceState(null, '', '/');
}

const platform = browserPlatform({
  relay: __ORMI_RELAY__,
  version: __ORMI_VERSION__,
  commit: __ORMI_COMMIT__,
});
bindBrowserLifecycle(platform);
createRoot(document.getElementById('root')!).render(<App platform={platform} pairPrefill={pairPrefill} />);
