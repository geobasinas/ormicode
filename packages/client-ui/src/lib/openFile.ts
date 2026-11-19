/** Cross-pane request to show a file in the Files pane (e.g. from a tool row).
 *  Kept until the pane mounts and takes it. */
export const OPEN_FILE = 'ormi:open-file';
let pending: { session: string; path: string; diff?: boolean } | undefined;
export function requestOpenFile(session: string, path: string, diff = false): void {
  pending = { session, path, ...(diff ? { diff: true } : {}) };
  window.dispatchEvent(new CustomEvent(OPEN_FILE, { detail: pending }));
}
export function takeOpenFile(session: string): { path: string; diff?: boolean } | undefined {
  if (pending?.session !== session) return undefined;
  const { path, diff } = pending; pending = undefined; return { path, ...(diff ? { diff: true } : {}) };
}
