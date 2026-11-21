/** Settings → Machines: each machine's live resources, and the project folders registered on it. */
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { agoText } from '../../lib/format.ts';
import { useProjects } from '../projects/useProjects.ts';
import { Button } from '../../components/Button.tsx';
import { Group, Message, Page, Row, Status, Value, failure, useHub } from './parts.tsx';
import { bytes, duration } from './format.ts';

interface Resources { cpus?: number; totalRam?: number; freeRam?: number; diskFree?: number; diskFloorBytes?: number; onBattery?: boolean; idleTimeoutMs?: number; pool?: { effective: number; cap: number } }
interface Machine { id: string; name: string; kind: 'local' | 'node' | 'boat'; status: 'online' | 'degraded' | 'offline'; heartbeat: number | null; reason?: string; resources?: Resources }

const KIND = { local: 'This computer', node: 'Remote machine', boat: 'Sandbox' } as const;

function MachineGroup({ machine }: { machine: Machine }) {
  const r = machine.resources;
  const lowDisk = r?.diskFree !== undefined && r.diskFloorBytes !== undefined && r.diskFree < r.diskFloorBytes;
  return <Group title={machine.name} action={<Status tone={machine.status === 'online' ? 'ok' : machine.status === 'degraded' ? 'warn' : 'error'}>{machine.status === 'online' ? 'Online' : machine.status === 'degraded' ? 'Degraded' : 'Offline'}</Status>}>
    <Row title={KIND[machine.kind]} hint={machine.reason ?? (machine.kind !== 'local' && machine.heartbeat ? `Last heartbeat ${agoText(machine.heartbeat)}` : undefined)} mono={false}>
      <Value mono>{machine.id}</Value>
    </Row>
    {r ? <>
      <Row title="Memory" hint={r.cpus ? `${r.cpus} CPU cores${r.onBattery ? ' · on battery' : ''}` : undefined}><Value>{bytes(r.freeRam)} free of {bytes(r.totalRam)}</Value></Row>
      <Row title="Disk" hint={r.diskFloorBytes !== undefined ? `New agents won't start below ${bytes(r.diskFloorBytes)} free` : undefined}>
        {lowDisk ? <Status tone="warn">{bytes(r.diskFree)} free</Status> : <Value>{bytes(r.diskFree)} free</Value>}
      </Row>
      {r.pool ? <Row title="Agent pool" hint={r.idleTimeoutMs ? `Idle agents stop after ${duration(r.idleTimeoutMs)}` : undefined}><Value>{r.pool.effective} at once · cap {r.pool.cap}</Value></Row> : null}
    </> : null}
  </Group>;
}

export function MachinesPanel({ connection }: { connection: string }) {
  const { transport } = usePlatform();
  const online = connection === 'online';
  const list = useHub<{ machines: Machine[] }>('machine.list', {}, online);
  const { projects, refresh } = useProjects();
  const names = new Map(list.data?.machines.map(m => [m.id, m.name]));
  const remove = async (machine: string, path: string) => {
    try {
      const r = await transport.request('project.remove', { machine, path });
      if (r.type !== 'res') return feedback.error(failure(r));
      feedback.success('Removed from the sidebar'); void refresh();
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); }
  };
  return <Page title="Machines" subtitle="Where your agents run, with live memory and disk">
    {!online ? <Group title="Machines"><Row title="Connect to the hub to see its machines" /></Group>
      : list.error ? <Group title="Machines"><Message tone="error">{list.error}</Message></Group>
        : list.data ? list.data.machines.map(m => <MachineGroup key={m.id} machine={m} />)
          : <Group title="Machines"><Row title="Loading machines…" /></Group>}
    <Group title="Project folders">
      {projects.length ? [...projects].sort((a, b) => a.name.localeCompare(b.name)).map(p =>
        <Row key={`${p.machine}:${p.path}`} title={p.name} hint={`${p.path}${names.size > 1 ? ` · ${names.get(p.machine) ?? p.machine}` : ''}${p.git ? '' : ' · no git'}`} mono>
          <Button variant="ghost" onClick={() => void remove(p.machine, p.path)} title="Removes it from the sidebar. Files and sessions are untouched.">Remove</Button>
        </Row>)
        : <Row title="No project folders yet" hint="Add one with the folder button above the session list." />}
    </Group>
  </Page>;
}
