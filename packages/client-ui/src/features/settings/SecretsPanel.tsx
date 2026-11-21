/** Settings → Secrets: names in the hub keyring, per machine or project. Values are write-only. */
import { useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { useProjects } from '../projects/useProjects.ts';
import { Button } from '../../components/Button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select.tsx';
import { Group, Message, Page, Row, Status, failure, useHub } from './parts.tsx';
import { Confirm } from './Confirm.tsx';

interface Secret { name: string; scope: 'project' | 'machine'; declared: boolean; missing: boolean }
interface SecretList { keyring: string; available: boolean; message?: string; secrets: Secret[] }
const NAME = /^[A-Z_][A-Z0-9_]*$/;
const field = { height: 30, fontSize: 12.5, background: 'var(--bg-inset)' } as const;

function useSecretCall(project: string, done: () => void) {
  const { transport } = usePlatform();
  return async (method: 'secret.set' | 'secret.delete', body: Record<string, unknown>, ok: string) => {
    try {
      const r = await transport.request(method, { ...body, ...(project ? { project } : {}) });
      if (r.type !== 'res') { feedback.error(failure(r)); return false; }
      feedback.success(ok); done(); return true;
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); return false; }
  };
}

function SecretRow({ item, project, available, changed }: { item: Secret; project: string; available: boolean; changed(): void }) {
  const call = useSecretCall(project, changed);
  const [value, setValue] = useState<string>();
  const save = async () => { if (value && await call('secret.set', { name: item.name, value }, `${item.name} saved`)) setValue(undefined); };
  const where = item.scope === 'project' ? 'this project' : 'all projects on this machine';
  return <Row title={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{item.name}</span>}
    hint={`${item.scope === 'project' ? 'Project' : 'Machine'} secret${item.declared ? ' · declared in .ormi/secrets.yaml' : ''}`}>
    {item.missing ? <Status tone="warn">No value</Status> : null}
    {value !== undefined ? <>
      <Input aria-label={`New value for ${item.name}`} type="password" autoComplete="new-password" autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setValue(undefined); }} style={{ ...field, width: 180 }} />
      <Button variant="primary" disabled={!value} onClick={() => void save()}>Save</Button>
      <Button variant="ghost" onClick={() => setValue(undefined)}>Cancel</Button>
    </> : <>
      <Button disabled={!available} onClick={() => setValue('')}>{item.missing ? 'Set value' : 'Replace'}</Button>
      {item.missing ? null : <Confirm label="Delete" disabled={!available} title={`Delete ${item.name}?`} confirm="Delete"
        description={`The value is removed from the keyring for ${where}. Sessions that need it won't start until it's set again.`}
        onConfirm={() => void call('secret.delete', { name: item.name }, `${item.name} deleted`)} />}
    </>}
  </Row>;
}

export function SecretsPanel({ connection }: { connection: string }) {
  const { projects } = useProjects();
  const [project, setProject] = useState('');
  const list = useHub<SecretList>('secret.list', project ? { project } : {}, connection === 'online');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const call = useSecretCall(project, () => void list.reload());
  const add = async () => { if (NAME.test(name) && value && await call('secret.set', { name, value }, `${name} saved`)) { setName(''); setValue(''); } };
  const available = list.data?.available ?? false;
  const local = projects.filter(p => p.machine === 'm_local');
  return <Page title="Secrets" subtitle="API keys and tokens agents get as environment variables. Values stay in the keyring and are redacted from transcripts.">
    <Group title="Scope">
      <Row title="Show secrets for" hint={project ? 'Project secrets override machine secrets with the same name.' : 'Machine secrets apply to every project.'}>
        <NativeSelect size="sm" aria-label="Secrets scope" value={project} onChange={e => setProject(e.target.value)} style={{ minWidth: 200, fontSize: 12.5 }}>
          <NativeSelectOption value="">Machine (all projects)</NativeSelectOption>
          {local.map(p => <NativeSelectOption key={p.path} value={p.path}>{p.name}</NativeSelectOption>)}
        </NativeSelect>
      </Row>
    </Group>
    <Group title="Secrets">
      {connection !== 'online' ? <Row title="Connect to the hub to manage secrets" />
        : list.error ? <Message tone="error">{list.error}</Message>
          : !list.data ? <Row title="Loading…" />
            : !available ? <Row title="No keyring on this hub" hint={list.data.message ?? 'Install a system keyring to store secrets.'}><Status tone="warn">Unavailable</Status></Row>
              : list.data.secrets.length ? list.data.secrets.map(s => <SecretRow key={`${s.scope}:${s.name}`} item={s} project={project} available={available} changed={() => void list.reload()} />)
                : <Row title="No secrets yet" hint="Add one below, or list names in a project's .ormi/secrets.yaml so sessions ask for them." />}
      {available ? <Row title="Add a secret" hint={`Saved for ${project ? 'this project' : 'every project on this machine'}.`} below={<div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Input aria-label="Secret name" placeholder="NAME" autoComplete="off" spellCheck={false} value={name} aria-invalid={(Boolean(name) && !NAME.test(name)) || undefined}
          onChange={e => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} style={{ ...field, width: 200, fontFamily: 'var(--font-mono)' }} />
        <Input aria-label="Secret value" placeholder="Value" type="password" autoComplete="new-password" value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add(); }} style={{ ...field, flex: 1 }} />
        <Button variant="primary" disabled={!NAME.test(name) || !value} onClick={() => void add()}>Add</Button>
      </div>} /> : null}
    </Group>
  </Page>;
}
