import { closeBrowserPlatform, resumeBrowserPlatform, type ClientPlatform } from '@ormicode/client-platform';

export function bindBrowserLifecycle(platform: ClientPlatform, target: EventTarget = window): () => void {
  const hide = () => closeBrowserPlatform(platform);
  const show = (event: Event) => { if ((event as PageTransitionEvent).persisted) resumeBrowserPlatform(platform); };
  target.addEventListener('pagehide', hide);
  target.addEventListener('pageshow', show);
  return () => {
    target.removeEventListener('pagehide', hide);
    target.removeEventListener('pageshow', show);
  };
}
