import { createRoot } from 'react-dom/client';
import { App } from '@ormicode/client-ui';
import { electronPlatform } from '@ormicode/client-platform';
import type { LayoutDescriptor } from '@ormicode/client-ui';
import '@ormicode/client-ui/index.css';
import './theme.css';

async function start() {
  const platform = electronPlatform();
  const stored = await platform.desktop?.layoutRead().catch(() => undefined);
  const descriptor = stored?.descriptor;
  if (stored?.errors.length) {
    try { localStorage.setItem('ormi.layout', JSON.stringify(descriptor ?? { version: 0, regions: {} })); } catch { /* unavailable */ }
  } else if (descriptor) {
    try { localStorage.setItem('ormi.layout', JSON.stringify(descriptor)); } catch { /* unavailable */ }
  }
  createRoot(document.getElementById('root')!).render(<App platform={platform} layout={stored && !stored.errors.length ? descriptor as LayoutDescriptor ?? undefined : undefined} />);
}

void start();
