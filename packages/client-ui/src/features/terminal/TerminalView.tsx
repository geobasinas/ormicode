/** One xterm bound to a broker terminal: attach replays scrollback from 0,
 *  output frames are de-duplicated by byte offset, input/resize go back. */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { usePlatform } from '../../lib/platform.ts';

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
/** xterm palette from the app's theme tokens, so the terminal follows dark/light themes. */
function tokenTheme() {
  const red = css('--accent-red', '#d69c98'); const green = css('--accent-mint', '#9acbaf'); const yellow = css('--accent-amber', '#d9b878');
  return {
    background: css('--bg-inset', '#171717'), foreground: css('--text-label', '#b7b7b7'),
    cursor: css('--text-title', '#f2f2f2'), cursorAccent: css('--bg-inset', '#171717'), selectionBackground: css('--bg-raised', '#2a2a2a'),
    black: css('--bg-raised', '#2a2a2a'), brightBlack: css('--text-hint', '#878787'),
    red, brightRed: red, green, brightGreen: green, yellow, brightYellow: yellow,
    ...(document.documentElement.dataset.theme === 'light'
      ? { blue: '#3f6fa8', brightBlue: '#5583bb', magenta: '#8a5aa8', brightMagenta: '#9d6fba', cyan: '#2f8a86', brightCyan: '#3e9c97' }
      : { blue: '#8faed1', brightBlue: '#a9c2df', magenta: '#bfa2d1', brightMagenta: '#cdb6dc', cyan: '#8ec5c2', brightCyan: '#a7d3d0' }),
    white: css('--text-label', '#b7b7b7'), brightWhite: css('--text-title', '#f2f2f2'),
  };
}

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = (s: string) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

export function TerminalView({ terminal, visible, onExit }: { terminal: string; visible: boolean; onExit: () => void }) {
  const { transport } = usePlatform();
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = host.current; if (!el) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12, lineHeight: 1.35, cursorBlink: true,
      scrollback: 5000, theme: tokenTheme(),
    });
    const themeWatch = new MutationObserver(() => { term.options.theme = tokenTheme(); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    const fit = new FitAddon(); fitRef.current = fit;
    term.loadAddon(fit); term.open(el);
    let next = 0;
    const prev = transport.onEvent;
    transport.onEvent = frame => {
      prev?.(frame);
      const f = frame as unknown as { type: string; terminal?: string; body: { kind: string; offset?: number; data?: string; code?: number | null } };
      if (f.type !== 'term' || f.terminal !== terminal) return;
      if (f.body.kind === 'terminal_exit') { term.write(`\r\n\x1b[2m[shell ended${f.body.code != null ? ` · ${f.body.code}` : ''}]\x1b[0m\r\n`); onExit(); return; }
      const bytes = b64(f.body.data ?? ''); const at = f.body.offset ?? 0;
      if (at + bytes.length <= next) return;
      term.write(at < next ? bytes.subarray(next - at) : bytes); next = at + bytes.length;
    };
    const resize = () => {
      if (!el.offsetWidth) return;
      try { fit.fit(); } catch { return; }
      void transport.request('terminal.resize', { terminal, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(resize); ro.observe(el);
    const input = term.onData(data => void transport.request('terminal.write', { terminal, data: toB64(data) }));
    void transport.request('terminal.attach', { terminal, from: 0 }).then(resize);
    return () => {
      ro.disconnect(); themeWatch.disconnect(); input.dispose(); transport.onEvent = prev;
      void transport.request('terminal.detach', { terminal }); term.dispose();
    };
  }, [transport, terminal]);

  useEffect(() => { if (visible) requestAnimationFrame(() => { try { fitRef.current?.fit(); } catch { /* hidden */ } }); }, [visible]);
  return <div ref={host} style={{ position: 'absolute', inset: 0, display: visible ? 'block' : 'none' }} />;
}
