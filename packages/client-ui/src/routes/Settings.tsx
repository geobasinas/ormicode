/** Settings tab (Settings-2 mockup): inner nav + one section at a time. Client-side
 * prefs live in localStorage; hub-backed panels live in SettingsPanels.tsx. */
import { useEffect, useState } from 'react';
import { Settings as Gear, Palette, SlidersHorizontal, Keyboard, Smartphone, Shield, Info, Coins, KeyRound, Globe, type LucideIcon } from 'lucide-react';
import { usePlatform } from '../lib/platform.ts';
import { useAppliedTheme } from '../lib/theme.ts';
import { projectName } from '../lib/format.ts';
import { LayoutSettings } from './LayoutSettings.tsx';
import { BrowserSettings } from './BrowserSettings.tsx';
import { Group, Row, ctl, label } from './SettingsRows.tsx';
import { PrivacySettings } from './PrivacySettings.tsx';
import { AboutSettings, DevicesSettings, SecretsSettings, UsageSettings } from './SettingsPanels.tsx';

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

type Section = { id: string; label: string; icon: LucideIcon };
const NAV: { group: string; items: Section[] }[] = [
  { group: 'GENERAL', items: [
    { id: 'general', label: 'General', icon: Gear }, { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'layout', label: 'Layout', icon: SlidersHorizontal },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }] },
  { group: 'HUB', items: [
    { id: 'devices', label: 'Paired devices', icon: Smartphone }, { id: 'browser', label: 'Browser', icon: Globe },
    { id: 'usage', label: 'Usage', icon: Coins }, { id: 'secrets', label: 'Secrets', icon: KeyRound }] },
  { group: 'DATA', items: [{ id: 'privacy', label: 'Data and privacy', icon: Shield }, { id: 'about', label: 'About', icon: Info }] },
];
const TITLES: Record<string, [string, string]> = {
  general: ['General', 'Defaults for sessions started from Home'],
  appearance: ['Appearance', 'Theme for this window'],
  layout: ['Layout', 'Agent layout changes, history and safe mode'],
  shortcuts: ['Keyboard shortcuts', 'Ctrl on Windows and Linux, Cmd on macOS'],
  devices: ['Paired devices', 'Phones and browsers that can reach your hub'],
  browser: ['Browser', 'Preview browser and checkpoint screenshots'],
  usage: ['Usage', 'Token and cost totals'],
  secrets: ['Secrets', 'Declared names and values in the hub keyring'],
  privacy: ['Data and privacy', 'Export or delete the hub’s data'],
  about: ['About', 'Versions and connection'],
};

const SHORTCUTS: [string, string][] = [
  ['Search sessions', 'Ctrl K'], ['New session', 'Ctrl N'], ['Go to Home', 'Ctrl 1'],
  ['Open Settings', 'Ctrl ,'], ['Send prompt', 'Enter'], ['New line in prompt', 'Shift Enter'],
];

function DefaultProjectPicker({ value, onChange }: { value: string; onChange(path: string): void }) {
  const { desktop } = usePlatform();
  const projects = loadPrefs().projects ?? [];
  const choose = async () => {
    const path = await desktop?.pickFolder?.() ?? (desktop ? null : globalThis.prompt?.('Project folder path') ?? null);
    if (path) { rememberProject(path); onChange(path); }
  };
  return <select aria-label="default project" className="ormi-select" style={{ ...ctl, width: 200 }} value={value} onChange={event => {
    if (event.target.value === '__choose') void choose();
    else onChange(event.target.value);
  }}>
    <option value="scratch">No project</option>
    {value !== 'scratch' && !projects.includes(value) ? <option value={value}>{projectName(value)}</option> : null}
    {projects.filter(path => path !== 'scratch').map(path => <option key={path} value={path}>{projectName(path)}</option>)}
    <option value="__choose">Choose folder…</option>
  </select>;
}

type DetectedAgent = { vendor: string; transports: string[] };

/** Agent picker backed by `agents.list` — only vendors the hub can actually start. */
function AgentPicker({ value, onChange }: { value: string; onChange(vendor: string): void }) {
  const { transport } = usePlatform();
  const [agents, setAgents] = useState<DetectedAgent[]>();
  useEffect(() => {
    let alive = true;
    void transport.request('agents.list', {}).then(r => {
      if (alive && r.type === 'res') setAgents((r.body as { agents: DetectedAgent[] }).agents.filter(a => a.vendor !== 'fake'));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [transport]);
  const detected = agents ?? PICKABLE_VENDORS.map(vendor => ({ vendor, transports: [] }));
  return <select aria-label="default agent" className="ormi-select" style={{ ...ctl, width: 200 }} value={value} onChange={e => onChange(e.target.value)}>
    {!detected.some(a => a.vendor === value) ? <option value={value}>{value}</option> : null}
    {detected.map(a => <option key={a.vendor} value={a.vendor}>{a.vendor}{a.transports.length ? ` · ${a.transports.join('/')}` : ''}</option>)}
  </select>;
}

const BRANCH_PREFIXES = ['ormi/', 'agent/', 'work/'];

/** Worktree branch prefix: common prefixes as a picker, anything else as a custom value. */
function BranchPrefixPicker({ value, onChange }: { value: string; onChange(prefix: string): void }) {
  const [customMode, setCustomMode] = useState(() => !BRANCH_PREFIXES.includes(value));
  const custom = customMode || !BRANCH_PREFIXES.includes(value);
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <select aria-label="Worktree branch prefix" className="ormi-select" style={{ ...ctl, width: custom ? 110 : 200, fontFamily: 'var(--font-mono)' }}
      value={custom ? '__custom' : value} onChange={e => {
        if (e.target.value === '__custom') setCustomMode(true);
        else { setCustomMode(false); onChange(e.target.value); }
      }}>
      {BRANCH_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
      <option value="__custom">Custom…</option>
    </select>
    {custom ? <input aria-label="Custom branch prefix" style={{ ...ctl, width: 120, fontFamily: 'var(--font-mono)' }}
      value={value} onChange={e => onChange(e.target.value)} placeholder="prefix/" /> : null}
  </span>;
}

const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']] as const;

export function SettingsView({ prefs, onPrefs, connection }: { prefs: Prefs; onPrefs: (p: Prefs) => void; connection?: string }) {
  const { desktop, web } = usePlatform();
  const [section, setSection] = useState('general');
  const groups = web ? NAV.map(g => ({ ...g, items: g.items.filter(it => it.id !== 'privacy') })) : NAV;
  const set = (patch: Partial<Prefs>) => { const p = { ...prefs, ...patch }; savePrefs(p); onPrefs(p); };
  useAppliedTheme(prefs.theme, desktop);
  const [title, sub] = TITLES[section]!;
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav style={{ width: 216, flexShrink: 0, borderRight: '1px solid var(--line-pane)', padding: '14px 10px', overflow: 'auto' }}>
        {groups.map(g => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div style={{ ...label, padding: '4px 8px 5px' }}>{g.group}</div>
            {g.items.map(it => (
              <button key={it.id} className="hv-sub" onClick={() => setSection(it.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 29, padding: '0 9px', border: 'none', borderRadius: 7,
                font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left',
                background: section === it.id ? 'var(--bg-selected)' : 'transparent', color: section === it.id ? 'var(--text-active)' : 'var(--text-label)',
              }}><it.icon size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />{it.label}</button>
            ))}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px 28px' }}>
        <div style={{ maxWidth: 800 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-title)' }}>{title}</h2>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
          {section === 'general' ? (
            <Group title="SESSION DEFAULTS">
              <Row title="Agent" hint="Vendor used for sessions started from Home">
                <AgentPicker value={prefs.defaultVendor} onChange={vendor => set({ defaultVendor: vendor })} />
              </Row>
              <Row title="Project" hint="Folder the session works in">
                <DefaultProjectPicker value={prefs.defaultProject} onChange={path => set({ defaultProject: path })} />
              </Row>
              <Row title="Worktree branch prefix" hint="Branches created for session worktrees" monoTitle>
                <BranchPrefixPicker value={prefs.worktreeBranchPrefix ?? 'ormi/'} onChange={prefix => set({ worktreeBranchPrefix: prefix })} />
              </Row>
            </Group>
          ) : null}
          {section === 'appearance' ? (
            <Group title="THEME">
              <Row title="Theme" hint="System follows your OS appearance">
                <span style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: 'var(--bg-inset)' }} role="radiogroup" aria-label="Theme">
                  {THEMES.map(([value, name]) => (
                    <button key={value} role="radio" aria-checked={prefs.theme === value} onClick={() => set({ theme: value })} style={{
                      height: 22, padding: '0 12px', border: 'none', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 11.5,
                      background: prefs.theme === value ? 'var(--bg-card)' : 'transparent',
                      color: prefs.theme === value ? 'var(--text-title)' : 'var(--text-secondary)',
                      boxShadow: prefs.theme === value ? '0 1px 2px rgba(0,0,0,.25)' : 'none',
                    }}>{name}</button>
                  ))}
                </span>
              </Row>
            </Group>
          ) : null}
          {section === 'layout' ? <LayoutSettings safeMode={prefs.safeMode ?? false} onSafeMode={value => set({ safeMode: value })} /> : null}
          {section === 'shortcuts' ? <Group title="SHORTCUTS">{SHORTCUTS.map(([a, k]) => <Row key={a} title={a}><span style={{ ...ctl, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-label)' }}>{k}</span></Row>)}</Group> : null}
          {section === 'devices' ? <DevicesSettings /> : null}
          {section === 'browser' ? <BrowserSettings /> : null}
          {section === 'usage' ? <UsageSettings /> : null}
          {section === 'secrets' ? <SecretsSettings /> : null}
          {section === 'privacy' ? <PrivacySettings /> : null}
          {section === 'about' ? <AboutSettings connection={connection} /> : null}
        </div>
      </div>
    </div>
  );
}
