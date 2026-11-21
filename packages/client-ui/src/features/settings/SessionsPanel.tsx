/** Settings → Agents: hub-wide limits the daemon reads live from the account settings table. */
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select.tsx';
import { Group, Page, Row, Status } from './parts.tsx';
import { NumberSetting } from './NumberSetting.tsx';
import { useHubSettings } from './useHubSettings.ts';

const MINUTE = 60_000;
const agentLabel = (id: string) => id === 'default' ? 'Automatic' : id.replace('/', ' · ');

export function SessionsPanel({ connection }: { connection: string }) {
  const hub = useHubSettings();
  const idleKey = `idleTimeout.${hub.profile ?? 'laptop'}`;
  const utility = hub.get('utility.agent');
  const num = (key: string, label: string, unit?: string, scale?: number, step?: number) =>
    <NumberSetting label={label} setting={hub.get(key)} unit={unit} scale={scale} step={step} onSave={value => hub.update(key, value)} />;
  if (connection !== 'online' || hub.error) return <Page title="Agents" subtitle="How many agents run, when idle ones stop, and team limits">
    <Group title="Hub settings"><Row title={hub.error ? 'Could not load hub settings' : 'Connect to the hub to change these'} hint={hub.error} /></Group>
  </Page>;
  return <Page title="Agents" subtitle="How many agents run, when idle ones stop, and team limits. Saved on the hub and applied right away.">
    <Group title="Workers">
      <Row title="Stop idle agents after" hint={`An idle agent process is stopped to free memory. The session stays and wakes on your next prompt (1–2 s). This hub runs as a ${hub.profile ?? 'laptop'}.`}>
        {num(idleKey, 'Idle timeout in minutes', 'min', MINUTE)}
      </Row>
      <Row title="Most agents at once" hint="Upper limit for the warm pool. The hub may run fewer when free memory is low.">
        {num('pool.cap', 'Maximum agents at once', 'agents')}
      </Row>
    </Group>
    <Group title="Titles and summaries">
      <Row title="Agent for small background calls" hint="Writes session titles, digest summaries and handoff briefs. Automatic uses the first installed agent.">
        <NativeSelect size="sm" aria-label="Utility agent" value={String(utility?.value ?? 'default')} disabled={!utility}
          onChange={e => void hub.update('utility.agent', e.target.value)} style={{ minWidth: 150, fontSize: 12.5 }}>
          {(utility?.choices ?? ['default']).map(c => <NativeSelectOption key={c} value={c}>{agentLabel(c)}</NativeSelectOption>)}
        </NativeSelect>
      </Row>
      <Row title="Daily spend limit" hint="Past this, the hub falls back to plain titles and summaries until tomorrow.">
        {num('utility.dailyCapUsd', 'Daily utility spend limit in USD', 'USD', 1, 0.5)}
      </Row>
    </Group>
    <Group title="Agent teams" action={<Status tone="muted">Applies to new spawns</Status>}>
      <Row title="Children per team" hint="Agents one parent may spawn into its team.">{num('team.children', 'Children per team', 'agents')}</Row>
      <Row title="Children running at once" hint="Others wait until one finishes.">{num('team.concurrent', 'Children running at once', 'agents')}</Row>
      <Row title="Team depth" hint="How many levels of children may spawn their own teams.">{num('team.depth', 'Team depth', 'levels')}</Row>
      <Row title="Open teams per parent">{num('team.maxTeams', 'Open teams per parent', 'teams')}</Row>
      <Row title="Nudge a silent child after" hint="The parent gets a note when a child has reported nothing for this long.">
        {num('team.silenceMs', 'Silence nudge in minutes', 'min', MINUTE)}
      </Row>
    </Group>
  </Page>;
}
