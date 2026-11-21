/** Client-side prefs in localStorage — session defaults and remembered projects.
 * The Settings page that edited these is deferred until the app is more complete. */
export interface Prefs { theme: string; defaultVendor: string; defaultProject: string; worktreeBranchPrefix?: string; projects?: string[]; safeMode?: boolean }
const KEY = 'ormi.prefs';
export const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];
/** Vendors offered in pickers — `fake` is the daemon's test agent, never a real default. */
export const PICKABLE_VENDORS = VENDORS.filter(v => v !== 'fake');
export function loadPrefs(theme = 'system'): Prefs {
  const base: Prefs = { theme, defaultVendor: 'claude', defaultProject: 'scratch', worktreeBranchPrefix: 'ormi/', safeMode: false };
  try { return { ...base, ...JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Prefs> }; } catch { return base; }
}
function savePrefs(p: Prefs) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }
/** Adds a folder to the composer's project list (most recent first, 12 max). */
export function rememberProject(path: string) {
  const prefs = loadPrefs();
  savePrefs({ ...prefs, projects: [path, ...(prefs.projects ?? []).filter(p => p !== path)].slice(0, 12) });
}
