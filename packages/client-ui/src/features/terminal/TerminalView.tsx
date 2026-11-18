/** One xterm bound to a broker terminal: attach replays scrollback from 0,
 *  output frames are de-duplicated by byte offset, input/resize go back. */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { usePlatform } from '../../lib/platform.ts';

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
      theme: { background: '#171717', foreground: '#cbcbcb', cursor: '#f2f2f2', selectionBackground: '#2f2f2f', green: '#9acbaf', red: '#d69c98', yellow: '#d9b878' },
    });
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
      ro.disconnect(); input.dispose(); transport.onEvent = prev;
      void transport.request('terminal.detach', { terminal }); term.dispose();
    };
  }, [transport, terminal]);

  useEffect(() => { if (visible) requestAnimationFrame(() => { try { fitRef.current?.fit(); } catch { /* hidden */ } }); }, [visible]);
  return <div ref={host} style={{ position: 'absolute', inset: 0, display: visible ? 'block' : 'none' }} />;
}
