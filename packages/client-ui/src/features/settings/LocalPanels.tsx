/** Settings panels that only touch this device: appearance, keyboard shortcuts and about. */
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { agoText } from '../../lib/format.ts';
import { defaultLayout } from '../../lib/layout.ts';
import { Button } from '../../components/Button.tsx';
import { Kbd } from '../../components/ui/kbd.tsx';
import { Group, Page, Row, Segmented, Status, Value, useHub } from './parts.tsx';
import { mod } from './format.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export function AppearancePanel({ theme, onTheme }: { theme: ThemeChoice; onTheme(theme: ThemeChoice): void }) {
  const resetLayout = () => {
    for (const key of ['ormi.shell', 'ormi.session.notes']) try { globalThis.localStorage?.removeItem(key); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('ormi-layout-change', { detail: { ...defaultLayout, source: 'user' } }));
    feedback.success('Layout reset — panel sizes apply on next open');
  };
  return <Page title="Appearance" subtitle="How the app looks on this device. Not synced to other devices.">
    <Group title="Theme">
      <Row title="Theme" hint="System follows your operating system's light or dark setting.">
        <Segmented label="Theme" value={theme} onChange={onTheme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
      </Row>
    </Group>
    <Group title="Layout">
      <Row title="Reset layout" hint="Sidebar width, right rail and panel sizes go back to their defaults.">
        <Button onClick={resetLayout}>Reset</Button>
      </Row>
    </Group>
  </Page>;
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['App', [['Search sessions', `${mod} K`], ['New session', `${mod} N`], ['Go to Home', `${mod} 1`], ['Open Settings', `${mod} ,`]]],
  ['Composer', [['Send', 'Enter'], ['New line', 'Shift Enter'], ['Steer the running turn', `${mod} Enter`], ['Search prompt history', `${mod} R`], ['Previous or next prompt', '↑ ↓']]],
  ['Panels', [['Commit (Git changes)', `${mod} Enter`], ['Pick an element (Browser)', 'Ctrl Shift C']]],
];

export function ShortcutsPanel() {
  return <Page title="Keyboard shortcuts" subtitle={mod === 'Cmd' ? 'Cmd on macOS' : 'Ctrl on Windows and Linux'}>
    {SHORTCUTS.map(([group, items]) => <Group key={group} title={group}>
      {items.map(([action, keys]) => <Row key={action} title={action}>
        <span style={{ display: 'inline-flex', gap: 4 }}>{keys.split(' ').map(k => <Kbd key={k}>{k}</Kbd>)}</span>
      </Row>)}
    </Group>)}
  </Page>;
}

interface Pricing { version: string | null; source: 'openrouter' | 'cache' | 'none'; fetchedAt: number | null; models: number; error?: string }
interface Agents { agents: { vendor: string; transports: string[] }[] }
const VENDOR: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'pi', grok: 'Grok', vibe: 'Vibe' };

export function AboutPanel({ connection }: { connection: string }) {
  const { transport, web } = usePlatform();
  const online = connection === 'online';
  const status = useHub<{ version: string; proto: number }>('daemon.status', {}, online);
  const agents = useHub<Agents>('agents.list', {}, online);
  const pricing = useHub<Pricing>('pricing.status', {}, online);
  const refresh = async () => {
    const r = await transport.request('pricing.refresh', {}).catch(() => undefined);
    if (r?.type === 'res') { feedback.success('Model prices updated'); void pricing.reload(); } else feedback.error('Could not update model prices');
  };
  const p = pricing.data;
  return <Page title="About" subtitle="Versions, agent integrations and model prices">
    <Group title="Versions">
      {web ? <Row title="Web app" hint={`Commit ${web.commit}`} mono><Value mono>{web.version}</Value></Row> : null}
      <Row title="Hub" hint={status.data ? `Protocol ${status.data.proto}` : online ? 'Loading…' : 'Not connected'}><Value mono>{status.data?.version ?? '—'}</Value></Row>
    </Group>
    <Group title="Agent integrations" action={<span style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>Transports this hub can start</span>}>
      {agents.data ? agents.data.agents.filter(a => a.vendor !== 'fake').map(a => <Row key={a.vendor} title={VENDOR[a.vendor] ?? a.vendor}>
        <span style={{ display: 'inline-flex', gap: 4 }}>{a.transports.map(t => <Kbd key={t}>{t}</Kbd>)}</span>
      </Row>) : <Row title={online ? 'Loading…' : 'Connect to the hub to list agents'} />}
    </Group>
    <Group title="Model prices">
      <Row title={p ? p.source === 'none' ? 'No price table' : `${p.models.toLocaleString()} models priced` : 'Price table'}
        hint={p ? p.error ?? (p.fetchedAt ? `From OpenRouter, updated ${agoText(p.fetchedAt)}${p.source === 'cache' ? ' (cached)' : ''}` : 'Costs show as unpriced until prices load.') : undefined}>
        {p?.error ? <Status tone="warn">Stale</Status> : null}
        <Button disabled={!online} onClick={() => void refresh()}>Update now</Button>
      </Row>
    </Group>
  </Page>;
}
