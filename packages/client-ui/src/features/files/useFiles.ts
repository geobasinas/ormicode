/** Files pane data: lazily loaded folder listings keyed by path, reloaded
 *  when the session's agent touches files; plus a typed request helper. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import type { Listing } from './types.ts';

const RELOAD_ON = new Set(['tool_result', 'checkpoint', 'checkpoint_restored', 'file_edit', 'turn_end']);

export function useFileRequest(session: string) {
  const { transport } = usePlatform();
  return useCallback(async <T>(method: string, body: Record<string, unknown> = {}): Promise<{ body?: T; error?: string; code?: string }> => {
    try {
      const res = await transport.request(method, { session, ...body });
      if (res.type === 'err') return { error: String((res as { message?: string }).message ?? res.code), code: String(res.code) };
      return { body: res.body as T };
    } catch (e) { return { error: String(e) }; }
  }, [transport, session]);
}

export function useListings(session: string) {
  const { transport } = usePlatform();
  const request = useFileRequest(session);
  const [dirs, setDirs] = useState<Record<string, Listing>>({});
  const [error, setError] = useState<string>();
  const loaded = useRef(new Set<string>());
  const load = useCallback(async (path: string) => {
    loaded.current.add(path);
    const r = await request<Listing>('file.list', { path });
    if (r.error) { setError(r.error); return; }
    setError(undefined);
    setDirs(d => ({ ...d, [path]: r.body! }));
  }, [request]);
  const reloadAll = useCallback(() => { for (const p of loaded.current) void load(p); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prev = transport.onEvent;
    transport.onEvent = frame => {
      prev?.(frame);
      if (frame.type !== 'evt' || frame.session !== session) return;
      const kind = String((frame.body as { kind?: unknown }).kind);
      if (!RELOAD_ON.has(kind)) return;
      clearTimeout(timer); timer = setTimeout(reloadAll, 600);
    };
    return () => { clearTimeout(timer); transport.onEvent = prev; };
  }, [transport, session, reloadAll]);
  return { dirs, error, load, reloadAll };
}
