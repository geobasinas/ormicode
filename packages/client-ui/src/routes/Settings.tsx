/** Settings tab (Settings-2 mockup): inner nav + one section at a time. Only
 * client-side prefs and existing daemon methods are wired; the rest say so. */
import { useEffect, useState, type ReactNode } from 'react';
import { Settings as Gear, Palette, SlidersHorizontal, Bell, Keyboard, Smartphone, Laptop, Shield, Info, Coins, type LucideIcon } from 'lucide-react';
import { usePlatform } from '../lib/platform.ts';
import { ago, compactTokens, formatUsd, projectName } from '../lib/format.ts';

export interface Prefs { theme: string; defaultVendor: string; defaultProject: string }
const KEY = 'ormi.prefs';
export const VENDORS = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe', 'fake'];
export function loadPrefs(theme = 'dark'): Prefs {
  const base: Prefs = { theme, defaultVendor: 'claude', defaultProject: 'scratch' };
  try { return { ...base, ...JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Prefs> }; } catch { return base; }
}
function savePrefs(p: Prefs) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

type Section = { id: string; label: string; icon: LucideIcon };
const NAV: { group: string; items: Section[] }[] = [
  { group: 'GENERAL', items: [
    { id: 'general', label: 'General', icon: Gear }, { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'defaults', label: 'Session defaults', icon: SlidersHorizontal }, { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }] },
  { group: 'CONNECTION', items: [{ id: 'devices', label: 'Paired devices', icon: Smartphone }, { id: 'machines', label: 'Machines', icon: Laptop }] },
  { group: 'DATA', items: [{ id: 'usage', label: 'Usage', icon: Coins }, { id: 'privacy', label: 'Data and privacy', icon: Shield }, { id: 'about', label: 'About', icon: Info }] },
];
const TITLES: Record<string, [string, string]> = {
  general: ['General', 'How ormicode runs on this computer'],
  appearance: ['Appearance', 'Theme for this window'],
  defaults: ['Session defaults', 'Used when you start a session from Home'],
  notifications: ['Notifications', 'When ormicode should get your attention'],
  shortcuts: ['Keyboard shortcuts', 'Ctrl on Windows and Linux, Cmd on macOS'],
  devices: ['Paired devices', 'Phones and browsers that can reach this hub'],
  machines: ['Machines', 'Computers running an ormicode daemon'],
  usage: ['Usage', 'Stored token and cost totals'],
  privacy: ['Data and privacy', 'What is stored and where'],
  about: ['About', 'Versions and connection'],
};

const label = { fontSize: 10, fontWeight: 600, color: 'var(--text-label)', letterSpacing: 1 };
const card = { background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 10, overflow: 'hidden' as const };
const ctl = {
  font: 'inherit', fontSize: 11.5, color: 'var(--text-title)', background: 'transparent', border: '1px solid var(--line-card)',
  borderRadius: 7, padding: '0 10px', height: 26, outline: 'none', boxSizing: 'border-box' as const,
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ marginTop: 18 }}><div style={{ ...label, margin: '0 0 7px' }}>{title}</div><div style={card}>{children}</div></div>;
}
function Row({ title, hint, children, mono }: { title: string; hint?: string; children?: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '7px 14px', boxSizing: 'border-box', borderTop: '1px solid var(--line-card)', marginTop: -1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-title)' }}>{title}</div>
        {hint ? <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
function Switch({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange?.(!on)} style={{
      width: 30, height: 17, borderRadius: 999, border: 'none', padding: 2, flexShrink: 0, cursor: disabled ? 'default' : 'pointer',
      background: on ? 'var(--accent-mint)' : 'var(--bg-raised)', opacity: disabled ? 0.5 : 1, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
    }}><span style={{ width: 13, height: 13, borderRadius: 999, background: on ? 'var(--bg-main)' : 'var(--text-hint)' }} /></button>
  );
}
const Soon = ({ what }: { what: string }) => <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{what}</span>;

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
      {list?.length === 0 ? <Row title="No paired devices" hint="Run ormi pair on this machine to add a phone or browser" /> : null}
      {list?.map(d => (
        <Row key={d.id} title={d.name} hint={`paired ${ago(d.trustedAt)} ago`}>
          <button className="hv-sub" style={{ ...ctl, cursor: 'pointer' }} onClick={() => void revoke(d.id, d.name)}>Revoke</button>
        </Row>
      ))}
    </Group>
  );
}

function About({ connection }: { connection?: string }) {
  const { transport } = usePlatform();
  const [st, setSt] = useState<{ version: string; uptimeMs: number; liveWorkers: number; relay: string }>();
  useEffect(() => { transport.request('daemon.status', {}).then(r => { if (r.type === 'res') setSt(r.body as unknown as typeof st); }).catch(() => undefined); }, [transport]);
  return (
    <Group title="DAEMON">
      <Row title="Connection" hint={connection ?? 'unknown'} />
      <Row title="Version" hint={st?.version ?? '…'} mono />
      <Row title="Uptime" hint={st ? ago(Date.now() - st.uptimeMs) : '…'} />
      <Row title="Live workers" hint={st ? String(st.liveWorkers) : '…'} />
      <Row title="Relay" hint={st?.relay ?? '…'} />
    </Group>
  );
}

export function SettingsView({ prefs, onPrefs, connection }: { prefs: Prefs; onPrefs: (p: Prefs) => void; connection?: string }) {
  const [section, setSection] = useState('general');
  const set = (patch: Partial<Prefs>) => { const p = { ...prefs, ...patch }; savePrefs(p); onPrefs(p); };
  const [title, sub] = TITLES[section]!;
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav style={{ width: 216, flexShrink: 0, borderRight: '1px solid var(--line-pane)', padding: '14px 10px', overflow: 'auto' }}>
        {NAV.map(g => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div style={{ ...label, padding: '4px 8px 5px' }}>{g.group}</div>
            {g.items.map(it => (
              <button key={it.id} className="hv-sub" onClick={() => setSection(it.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 29, padding: '0 9px', border: 'none', borderRadius: 7,
                font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left',
                background: section === it.id ? 'var(--bg-card)' : 'transparent', color: section === it.id ? 'var(--text-title)' : 'var(--text-label)',
              }}><it.icon size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />{it.label}</button>
            ))}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px 28px' }}>
        <div style={{ maxWidth: 800 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-title)' }}>{title}</h2>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
          {section === 'general' ? <>
            <Group title="STARTUP">
              <Row title="Launch at login" hint="Open ormicode when you sign in to your computer"><Switch on={false} disabled /></Row>
              <Row title="Keep running in the tray" hint="The daemon keeps sessions running after you close the window"><Soon what="daemon always runs" /></Row>
            </Group>
            <Group title="WORKSPACE">
              <Row title="Default project folder" hint={prefs.defaultProject} mono>
                <input aria-label="default project" style={{ ...ctl, width: 200, fontFamily: 'var(--font-mono)' }} value={prefs.defaultProject} onChange={e => set({ defaultProject: e.target.value || 'scratch' })} />
              </Row>
              <Row title="Language" hint="Used for menus and messages"><Soon what="English" /></Row>
            </Group>
          </> : null}
          {section === 'appearance' ? (
            <Group title="THEME">
              {['dark', 'light'].map(t => (
                <Row key={t} title={t === 'dark' ? 'Dark' : 'Light'} hint={t === 'dark' ? 'Matches the mockups' : 'Same layout, light palette'}>
                  <Switch on={prefs.theme === t} onChange={() => set({ theme: t })} />
                </Row>
              ))}
            </Group>
          ) : null}
          {section === 'defaults' ? (
            <Group title="NEW SESSIONS">
              <Row title="Agent" hint="Vendor picked in the Home composer">
                <select aria-label="default agent" className="ormi-select" style={ctl} value={prefs.defaultVendor} onChange={e => set({ defaultVendor: e.target.value })}>
                  {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Row>
              <Row title="Project" hint="Path, or scratch for no project" mono>
                <input aria-label="default session project" style={{ ...ctl, width: 200, fontFamily: 'var(--font-mono)' }} value={prefs.defaultProject} onChange={e => set({ defaultProject: e.target.value || 'scratch' })} />
              </Row>
            </Group>
          ) : null}
          {section === 'notifications' ? <Group title="ALERTS"><Row title="Approval and question alerts" hint="Desktop notifications are not wired yet; Needs you on Home lists them"><Soon what="soon" /></Row></Group> : null}
          {section === 'shortcuts' ? <Group title="SHORTCUTS">{SHORTCUTS.map(([a, k]) => <Row key={a} title={a}><span style={{ ...ctl, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-label)' }}>{k}</span></Row>)}</Group> : null}
          {section === 'devices' ? <Devices /> : null}
          {section === 'machines' ? <Group title="THIS MACHINE"><Row title="local" hint="Other machines appear here once multi-machine hubs ship"><Soon what="soon" /></Row></Group> : null}
          {section === 'usage' ? <Usage /> : null}
          {section === 'privacy' ? <Group title="STORAGE"><Row title="Sessions and journals" hint="~/.ormicode/ on this machine. The relay only forwards encrypted frames." mono /></Group> : null}
          {section === 'about' ? <About connection={connection} /> : null}
        </div>
      </div>
    </div>
  );
}
