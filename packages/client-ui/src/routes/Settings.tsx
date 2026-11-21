/** Settings tab (Settings-2 mockup): inner nav + one section at a time. Only
 * client-side prefs and existing daemon methods are wired; the rest say so. */
import { useEffect, useLayoutEffect, useState } from 'react';
import { Settings as Gear, Palette, SlidersHorizontal, Keyboard, Smartphone, Shield, Info, Coins, KeyRound, Globe, type LucideIcon } from 'lucide-react';
import { usePlatform } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { ago, compactTokens, formatUsd, projectName } from '../lib/format.ts';
import { useSessions } from '../features/session/useSessions.ts';
import { LayoutSettings } from './LayoutSettings.tsx';
import { BrowserSettings } from './BrowserSettings.tsx';
import { SettingsSwitch } from './SettingsSwitch.tsx';
import { Group, Row, ctl, label } from './SettingsRows.tsx';
import { PrivacySettings } from './PrivacySettings.tsx';

export interface Prefs { theme: string; defaultVendor: string; defaultProject: string; worktreeBranchPrefix?: string; projects?: string[]; safeMode?: boolean; screenshotAtCheckpoint?: boolean }
const KEY = 'ormi.prefs';
export const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];
export function loadPrefs(theme = 'dark'): Prefs {
  const base: Prefs = { theme, defaultVendor: 'claude', defaultProject: 'scratch', worktreeBranchPrefix: 'ormi/', safeMode: false, screenshotAtCheckpoint: true };
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

interface CostBucket { tokens: number; usd: number | null; unpriced: number; estimate: boolean }
interface CostTotals {
  total: CostBucket;
  projects: ({ project: string } & CostBucket)[];
  days: ({ date: string } & CostBucket)[];
  sessions: ({ session: string; project: string } & CostBucket)[];
}

function amount(bucket: CostBucket): string {
  return bucket.usd === null ? '—' : `${formatUsd(bucket.usd)}${bucket.estimate ? ' estimate' : ''}`;
}
function usageHint(bucket: CostBucket): string {
  return `${compactTokens(bucket.tokens)} tokens${bucket.unpriced ? ` · ${bucket.unpriced} unpriced` : ''}`;
}

function Usage() {
  const { transport } = usePlatform();
  const [totals, setTotals] = useState<CostTotals>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    void transport.request('cost.totals', { since: Date.now() - 30 * 24 * 60 * 60 * 1000 }).then(res => {
      if (!alive) return;
      if (res.type === 'res') setTotals(res.body as unknown as CostTotals);
      else setError(res.type === 'err' ? `${res.code}: ${res.message}` : 'unexpected reply');
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [transport]);
  const recentDays = [...(totals?.days ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-14).reverse();
  const unavailable = error ? <Row title="Could not load usage" hint={error} /> : !totals ? <Row title="Loading usage" /> : null;
  return <>
    <Group title="LAST 30 DAYS">
      {unavailable ?? <Row title="Total" hint={usageHint(totals!.total)}><span style={{ fontSize: 11.5, color: 'var(--text-label)' }}>{amount(totals!.total)}</span></Row>}
    </Group>
    <Group title="BY PROJECT">
      {unavailable ?? (totals!.projects.length
        ? totals!.projects.map(p => <Row key={p.project} title={projectName(p.project)} hint={usageHint(p)}><span style={{ fontSize: 11.5, color: 'var(--text-label)' }}>{amount(p)}</span></Row>)
        : <Row title="No usage in the last 30 days" />)}
    </Group>
    <Group title="BY DAY">
      {unavailable ?? (recentDays.length
        ? recentDays.map(day => <Row key={day.date} title={day.date} hint={usageHint(day)}><span style={{ fontSize: 11.5, color: 'var(--text-label)' }}>{amount(day)}</span></Row>)
        : <Row title="No usage in the last 14 days" />)}
    </Group>
  </>;
}

interface ListedSecret { name: string; scope: 'project' | 'machine'; declared: boolean; missing: boolean }
interface SecretList { keyring: string; available: boolean; message?: string; secrets: ListedSecret[] }
const secretName = /^[A-Z_][A-Z0-9_]*$/;
const secretButton = { ...ctl, cursor: 'pointer', fontSize: 11 } as const;

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

function SecretItem({ item, project, available, changed }: { item: ListedSecret; project: string; available: boolean; changed: () => void }) {
  const { transport } = usePlatform();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy || !value) return;
    setBusy(true); setError('');
    try {
      const r = await transport.request('secret.set', { name: item.name, value, ...(project ? { project } : {}) });
      if (r.type === 'res') { setEditing(false); setValue(''); changed(); }
      else setError(`${r.code}: ${r.message}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await transport.request('secret.delete', { name: item.name, ...(project ? { project } : {}) });
      if (r.type === 'res') { setDeleting(false); changed(); }
      else setError(`${r.code}: ${r.message}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <>
  <Row title={item.name} monoTitle hint={`${item.scope === 'project' ? 'Project' : 'Machine'} secret${item.declared ? ' · declared' : ''}`}>
    {item.missing ? <span style={{ color: 'var(--accent-amber)', fontSize: 11 }}>missing</span> : null}
    {editing ? <>
      <input aria-label={`Set ${item.name}`} autoFocus autoComplete="new-password" type="password" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); void save(); }
        if (e.key === 'Escape') { setEditing(false); setValue(''); setError(''); }
      }} disabled={!available || busy} style={{ ...ctl, width: 150 }} />
      <button style={secretButton} disabled={!available || !value || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      <button style={secretButton} disabled={busy} onClick={() => { setEditing(false); setValue(''); setError(''); }}>Cancel</button>
    </> : deleting ? <>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Delete {item.name}?</span>
      <button style={secretButton} disabled={!available || busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete'}</button>
      <button style={secretButton} disabled={busy} onClick={() => { setDeleting(false); setError(''); }}>Cancel</button>
    </> : <>
      <button style={secretButton} disabled={!available} onClick={() => { setEditing(true); setError(''); }}>Set</button>
      <button style={secretButton} disabled={!available} onClick={() => { setDeleting(true); setError(''); }}>Delete</button>
    </>}
  </Row>
  {error ? <div role="alert" style={{ padding: '0 14px 7px', fontSize: 11, color: 'var(--accent-red)' }}>{error}</div> : null}
  </>;
}

function Secrets() {
  const { transport } = usePlatform();
  const { sessions } = useSessions();
  const [project, setProject] = useState('');
  const [list, setList] = useState<SecretList>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const projects = [...new Set(sessions.map(s => s.project))].sort();
  const changed = () => setRefresh(n => n + 1);
  useEffect(() => {
    let alive = true;
    void transport.request('secret.list', project ? { project } : {}).then(r => {
      if (!alive) return;
      if (r.type === 'res') { setList(r.body as unknown as SecretList); setError(undefined); }
      else setError(`${r.code}: ${r.message}`);
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [transport, project, refresh]);
  const save = async () => {
    if (saving || !secretName.test(name) || !value) return;
    setSaving(true); setSaveError('');
    try {
      const r = await transport.request('secret.set', { name, value, ...(project ? { project } : {}) });
      if (r.type === 'res') { setName(''); setValue(''); changed(); }
      else setSaveError(`${r.code}: ${r.message}`);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const available = list?.available ?? false;
  return <>
    <Group title="SCOPE">
      <Row title="Project">
        <select aria-label="Secrets project" className="ormi-select" style={ctl} value={project} onChange={e => setProject(e.target.value)}>
          <option value="">Machine (all projects)</option>
          {projects.map(p => <option key={p} value={p}>{projectName(p)}</option>)}
        </select>
      </Row>
    </Group>
    <Group title="SECRETS">
      {error ? <Row title="Could not load secrets" hint={error} /> : null}
      {list && !list.available ? <Row title="Keyring unavailable" hint={list.message ?? 'No keyring backend is available.'} /> : null}
      {list?.secrets.map(item => <SecretItem key={`${item.scope}:${item.name}`} item={item} project={project} available={available} changed={changed} />)}
      <Row title="Add secret">
        <input aria-label="Secret name" autoComplete="off" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.focus(); } }} disabled={!available || saving} placeholder="UPPER_SNAKE_CASE" style={{ ...ctl, width: 140, fontFamily: 'var(--font-mono)' }} />
        <input aria-label="Secret value" type="password" autoComplete="new-password" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } if (e.key === 'Escape') { setName(''); setValue(''); setSaveError(''); } }} disabled={!available || saving} style={{ ...ctl, width: 150 }} />
        <button style={secretButton} disabled={!available || !secretName.test(name) || !value || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </Row>
      {saveError ? <div role="alert" style={{ padding: '0 14px 7px', fontSize: 11, color: 'var(--accent-red)' }}>{saveError}</div> : null}
    </Group>
  </>;
}

const SHORTCUTS: [string, string][] = [
  ['New session', 'Ctrl N'], ['Search sessions', 'Ctrl K'], ['Home', 'Ctrl 1'], ['Settings', 'Ctrl ,'],
  ['Toggle sidebar', 'Ctrl B'], ['Send prompt', 'Enter'], ['New line in prompt', 'Shift Enter'],
];

function Devices() {
  const { transport } = usePlatform();
  const [list, setList] = useState<{ id: string; name: string; trustedAt: number }[]>();
  const [error, setError] = useState<string>();
  const load = () => transport.request('devices.list', {})
    .then(r => r.type === 'res' ? setList((r.body as unknown as { devices: { id: string; name: string; trustedAt: number }[] }).devices) : setError(r.type === 'err' ? r.message : 'unexpected reply'))
    .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [transport]);
  const revoke = async (id: string, name: string) => {
    if (!globalThis.confirm?.(`Revoke ${name}? It will need to pair again.`)) return;
    await transport.request('devices.revoke', { device: id, confirm: id }).catch((e: Error) => setError(e.message));
    void load();
  };
  return (
    <Group title="DEVICES">
      {error ? <Row title="Could not load devices" hint={error} /> : null}
      {list?.length === 0 ? <Row title="No paired devices" hint="Run ormi pair on your hub to add a phone or browser" /> : null}
      {list?.map(d => (
        <Row key={d.id} title={d.name} hint={`Paired ${ago(d.trustedAt)} ago`}>
          <button className="hv-sub" style={{ ...ctl, cursor: 'pointer' }} onClick={() => void revoke(d.id, d.name)}>Revoke</button>
        </Row>
      ))}
    </Group>
  );
}

function About({ connection }: { connection?: string }) {
  const platform = usePlatform();
  const { transport } = platform;
  const [st, setSt] = useState<{ version: string; uptimeMs: number; liveWorkers: number; relay: string }>();
  const [remote, setRemote] = useState<{ account: string; device: string; name: string } | null>();
  useEffect(() => {
    if (platform.web) void (platform.web.remote?.() ?? Promise.resolve(null)).then(setRemote).catch(() => undefined);
    else transport.request('daemon.status', {}).then(r => { if (r.type === 'res') setSt(r.body as unknown as typeof st); }).catch(() => undefined);
  }, [platform, transport]);
  const backend = platform.desktop?.storageBackend();
  return (
    <Group title="DAEMON">
      <Row title="Connection" hint={connection ?? 'unknown'} />
      {platform.web ? <>
        {remote ? <Row title="This browser" hint={`${remote.name} · ${remote.account}`} /> : null}
        <Row title="Web version" hint={platform.web.version} />
        <Row title="Commit" hint={platform.web.commit} mono />
        <Row title="Relay" hint={platform.web.relayUrl} mono />
        <Row title="Forget this browser" hint="Removes the pairing; a new code is needed to reconnect">
          <button className="hv-sub" style={{ ...ctl, cursor: 'pointer' }} onClick={() => {
            if (window.confirm('Forget this browser? You will need a new pairing code to reconnect.')) void platform.web?.unpair();
          }}>Forget</button>
        </Row>
      </> : <>
      <Row title="Version" hint={st?.version ?? '…'} mono />
      <Row title="Uptime" hint={st ? ago(Date.now() - st.uptimeMs) : '…'} />
      <Row title="Live workers" hint={st ? String(st.liveWorkers) : '…'} />
      <Row title="Relay" hint={st?.relay ?? '…'} />
      {backend === 'basic_text' ? <Row title="Device token storage" hint="No system keyring found — the token is stored as basic text" /> : null}
      </>}
    </Group>
  );
}

export function SettingsView({ prefs, onPrefs, connection }: { prefs: Prefs; onPrefs: (p: Prefs) => void; connection?: string }) {
  const { desktop, web } = usePlatform();
  const [section, setSection] = useState('general');
  const groups = web ? NAV.map(g => ({ ...g, items: g.items.filter(it => it.id !== 'privacy') })) : NAV;
  const set = (patch: Partial<Prefs>) => { const p = { ...prefs, ...patch }; savePrefs(p); onPrefs(p); };
  useLayoutEffect(() => {
    applyTheme(themeByName(prefs.theme));
    if (prefs.theme === 'light' || prefs.theme === 'dark') desktop?.setTheme?.(prefs.theme);
  }, [desktop, prefs.theme]);
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
                <select aria-label="default agent" className="ormi-select" style={ctl} value={prefs.defaultVendor} onChange={e => set({ defaultVendor: e.target.value })}>
                  {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Row>
              <Row title="Project" hint="Folder the session works in">
                <DefaultProjectPicker value={prefs.defaultProject} onChange={path => set({ defaultProject: path })} />
              </Row>
              <Row title="Worktree branch prefix" hint="Branches created for session worktrees" monoTitle>
                <input aria-label="Worktree branch prefix" style={{ ...ctl, width: 200, fontFamily: 'var(--font-mono)' }}
                  value={prefs.worktreeBranchPrefix ?? 'ormi/'} onChange={e => set({ worktreeBranchPrefix: e.target.value })} />
              </Row>
            </Group>
          ) : null}
          {section === 'browser' ? <BrowserSettings /> : null}
          {section === 'appearance' ? (
            <Group title="THEME">
              {['dark', 'light'].map(t => (
                <Row key={t} title={t === 'dark' ? 'Dark' : 'Light'}>
                  <SettingsSwitch ariaLabel={t === 'dark' ? 'Dark theme' : 'Light theme'} on={prefs.theme === t} onChange={checked => { if (checked) set({ theme: t }); }} />
                </Row>
              ))}
            </Group>
          ) : null}
          {section === 'layout' ? <LayoutSettings safeMode={prefs.safeMode ?? false} onSafeMode={value => set({ safeMode: value })} /> : null}
          {section === 'shortcuts' ? <Group title="SHORTCUTS">{SHORTCUTS.map(([a, k]) => <Row key={a} title={a}><span style={{ ...ctl, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-label)' }}>{k}</span></Row>)}</Group> : null}
          {section === 'devices' ? <Devices /> : null}
          {section === 'usage' ? <Usage /> : null}
          {section === 'secrets' ? <Secrets /> : null}
          {section === 'privacy' ? <PrivacySettings /> : null}
          {section === 'about' ? <About connection={connection} /> : null}
        </div>
      </div>
    </div>
  );
}
