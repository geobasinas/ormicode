/** Settings tab: grouped inner nav (desktop) or a list that opens each section (narrow), one section at a time. */
import { useState, type ReactNode } from 'react';
import {
  Settings as Gear, Palette, Bot, Keyboard, Smartphone, Server, Globe, KeyRound, Coins, Shield, Info, ChevronLeft, ChevronRight, type LucideIcon,
} from 'lucide-react';
import { useIsMobile } from '../../hooks/use-mobile.ts';
import { GeneralPanel } from './GeneralPanel.tsx';
import { SessionsPanel } from './SessionsPanel.tsx';
import { DevicesPanel } from './DevicesPanel.tsx';
import { MachinesPanel } from './MachinesPanel.tsx';
import { BrowserPanel } from './BrowserPanel.tsx';
import { SecretsPanel } from './SecretsPanel.tsx';
import { UsagePanel } from './UsagePanel.tsx';
import { PrivacyPanel } from './PrivacyPanel.tsx';
import { AboutPanel, AppearancePanel, ShortcutsPanel, type ThemeChoice } from './LocalPanels.tsx';

type Section = { id: string; label: string; hint: string; icon: LucideIcon };
const NAV: { group: string; items: Section[] }[] = [
  { group: 'General', items: [
    { id: 'general', label: 'General', hint: 'Connection and hub status', icon: Gear },
    { id: 'appearance', label: 'Appearance', hint: 'Theme and layout', icon: Palette },
    { id: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Every shortcut in the app', icon: Keyboard },
  ] },
  { group: 'Agents', items: [
    { id: 'agents', label: 'Agents', hint: 'Workers, idle timeout and teams', icon: Bot },
    { id: 'browser', label: 'Browser preview', hint: 'Screenshots and UI checks', icon: Globe },
    { id: 'secrets', label: 'Secrets', hint: 'Keys agents get as env vars', icon: KeyRound },
  ] },
  { group: 'Connection', items: [
    { id: 'devices', label: 'Paired devices', hint: 'Pair, rename and revoke', icon: Smartphone },
    { id: 'machines', label: 'Machines', hint: 'Resources and project folders', icon: Server },
  ] },
  { group: 'Data', items: [
    { id: 'usage', label: 'Usage', hint: 'Tokens and cost', icon: Coins },
    { id: 'privacy', label: 'Data and privacy', hint: 'Export or delete local data', icon: Shield },
    { id: 'about', label: 'About', hint: 'Versions and model prices', icon: Info },
  ] },
];
const ALL = NAV.flatMap(g => g.items);
const KEY = 'ormi.settings.section';

function Panel({ id, connection, theme, onTheme }: { id: string; connection: string; theme: ThemeChoice; onTheme(t: ThemeChoice): void }): ReactNode {
  switch (id) {
    case 'appearance': return <AppearancePanel theme={theme} onTheme={onTheme} />;
    case 'shortcuts': return <ShortcutsPanel />;
    case 'agents': return <SessionsPanel connection={connection} />;
    case 'browser': return <BrowserPanel connection={connection} />;
    case 'secrets': return <SecretsPanel connection={connection} />;
    case 'devices': return <DevicesPanel connection={connection} />;
    case 'machines': return <MachinesPanel connection={connection} />;
    case 'usage': return <UsagePanel connection={connection} />;
    case 'privacy': return <PrivacyPanel connection={connection} />;
    case 'about': return <AboutPanel connection={connection} />;
    default: return <GeneralPanel connection={connection} />;
  }
}

const groupLabel = { fontSize: 10.5, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-hint)' } as const;

export function SettingsView({ connection, theme, onTheme }: { connection: string; theme: ThemeChoice; onTheme(t: ThemeChoice): void }) {
  const mobile = useIsMobile();
  const [section, setSection] = useState(() => {
    const saved = globalThis.localStorage?.getItem(KEY);
    return ALL.some(s => s.id === saved) ? saved! : 'general';
  });
  const [detail, setDetail] = useState(false);
  const choose = (id: string) => {
    setSection(id); setDetail(true);
    try { globalThis.localStorage?.setItem(KEY, id); } catch { /* private mode */ }
  };
  const body = <div key={section} style={{ maxWidth: 780, margin: '0 auto', padding: mobile ? '12px 16px 32px' : '20px 32px 36px' }}>
    <Panel id={section} connection={connection} theme={theme} onTheme={onTheme} />
  </div>;

  if (mobile) return <div style={{ height: '100%', overflow: 'auto' }}>
    {detail ? <>
      <button type="button" className="hv-sub" onClick={() => setDetail(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '12px 8px 0', padding: '6px 8px', border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-secondary)', font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
        <ChevronLeft size={16} />Settings
      </button>
      {body}
    </> : <div style={{ padding: '20px 16px 40px' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--text-title)' }}>Settings</h1>
      {NAV.map(g => <section key={g.group} style={{ marginTop: 22 }}>
        <h2 style={{ ...groupLabel, margin: '0 4px 8px' }}>{g.group}</h2>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 12, overflow: 'hidden' }}>
          {g.items.map(({ id, label, hint, icon: Icon }, i) => <button key={id} type="button" className="hv-sub" onClick={() => choose(id)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: 'none', borderTop: i ? '1px solid var(--line-divider)' : 'none',
            background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer',
          }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--bg-raised)', color: 'var(--text-label)' }}><Icon size={15} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, color: 'var(--text-title)' }}>{label}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{hint}</span>
            </span>
            <ChevronRight size={16} style={{ color: 'var(--text-hint)' }} />
          </button>)}
        </div>
      </section>)}
    </div>}
  </div>;

  return <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
    <nav aria-label="Settings sections" style={{ width: 232, flexShrink: 0, overflow: 'auto', padding: '18px 10px', borderRight: '1px solid var(--line-pane)', boxSizing: 'border-box' }}>
      {NAV.map((g, gi) => <div key={g.group} style={{ marginTop: gi ? 18 : 0 }}>
        <div style={{ ...groupLabel, padding: '0 10px 6px' }}>{g.group}</div>
        {g.items.map(({ id, label, icon: Icon }) => {
          const on = id === section;
          return <button key={id} type="button" aria-current={on ? 'page' : undefined} className={on ? undefined : 'hv-sub'} onClick={() => choose(id)} style={{
            width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', marginBottom: 1, border: 'none', borderRadius: 7,
            background: on ? 'var(--bg-selected)' : 'transparent', color: on ? 'var(--text-active)' : 'var(--text-label)',
            font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer',
          }}><Icon size={15} style={{ color: on ? 'var(--text-active)' : 'var(--text-secondary)', flexShrink: 0 }} />{label}</button>;
        })}
      </div>)}
    </nav>
    <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>{body}</div>
  </div>;
}
