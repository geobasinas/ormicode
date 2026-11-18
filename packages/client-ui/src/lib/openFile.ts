/** Cross-pane request to show a file in the Files pane (e.g. from a tool row).
 *  Kept until the pane mounts and takes it. */
export const OPEN_FILE = 'ormi:open-file';
let pending: { session: string; path: string } | undefined;
export function requestOpenFile(session: string, path: string): void {
  pending = { session, path };
  window.dispatchEvent(new CustomEvent(OPEN_FILE, { detail: pending }));
}
export function takeOpenFile(session: string): string | undefined {
  if (pending?.session !== session) return undefined;
  const p = pending.path; pending = undefined; return p;
}
