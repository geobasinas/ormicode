import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Laptop, LoaderCircle, Server, X } from 'lucide-react';
import { Button } from '../../components/Button.tsx';
import { usePlatform } from '../../lib/platform.ts';
import { agoText } from '../../lib/format.ts';
import { feedback } from '../../lib/feedback.ts';
import { useModalFocus } from '../../lib/useModalFocus.ts';
import { useProjects } from './useProjects.ts';
import { FolderBrowser } from './FolderBrowser.tsx';

interface Machine {
  id: string; name: string; kind: 'local' | 'node' | 'boat';
  status: 'online' | 'degraded' | 'offline'; heartbeat: number | null;
}

export function AddProjectDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { transport, desktop } = usePlatform();
  const { refresh } = useProjects();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machine, setMachine] = useState<Machine>();
  const [browse, setBrowse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(open, dialog, onClose);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBrowse(false); setMachine(undefined); setError(''); setLoading(true);
    void transport.request('machine.list', {}).then(result => {
      if (!alive) return;
      if (result.type === 'res') setMachines((result.body as { machines?: Machine[] }).machines ?? []);
      else setError('Could not load machines. Try again.');
    }).catch(() => { if (alive) setError('Could not load machines. Check your connection.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, transport]);

  const add = async (target: Machine, path: string) => {
    setBusy(true); setError('');
    try {
      const result = await transport.request('project.add', { machine: target.id, path });
      if (result.type === 'err') { setError(messageFor(result.code)); return; }
      const project = (result.body as { project: { path: string; name: string } }).project;
      await refresh();
      feedback.success(`Added ${project.name}`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this project.');
    } finally { setBusy(false); }
  };

  const chooseMachine = async (target: Machine) => {
    if (target.status === 'offline') return;
    setError('');
    if (desktop && target.id === 'm_local' && desktop.linkIsLocal()) {
      try {
        const path = await desktop.pickFolder();
        if (path) await add(target, path);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the folder picker.'); }
      return;
    }
    setMachine(target);
    setBrowse(true);
  };

  if (!open) return null;
  return <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={scrim}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="Add a project" style={dialogStyle}>
      {!browse ? <>
        <div style={header}>
          <div><strong style={{ fontSize: 15 }}>Add a project</strong><div style={hint}>Choose a machine</div></div>
          <button aria-label="Close" onClick={onClose} style={iconButton}><X size={15} /></button>
        </div>
        {loading ? <div style={status}><LoaderCircle size={14} className="animate-spin" />Loading machines…</div>
          : <>{error ? <div role="alert" style={errorStyle}>{error}</div> : null}
            {machines.length ? <div style={{ display: 'grid', gap: 5 }}>
              {machines.map(item => <MachineRow key={item.id} machine={item} disabled={busy} onSelect={() => void chooseMachine(item)} />)}
            </div> : !error ? <div style={status}>No machines are available.</div> : null}</>}
        <div style={footer}><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </> : machine ? <FolderBrowser machine={machine} busy={busy} error={error}
        onBack={() => { setBrowse(false); setMachine(undefined); setError(''); }}
        onCancel={onClose} onAdd={path => void add(machine, path)} /> : null}
    </section>
  </div>;
}

function MachineRow({ machine, disabled, onSelect }: { machine: Machine; disabled: boolean; onSelect(): void }) {
  const offline = machine.status === 'offline';
  const Icon = machine.kind === 'local' ? Laptop : Server;
  const statusText = offline
    ? `Offline · last seen ${machine.heartbeat == null ? 'never' : agoText(machine.heartbeat)}`
    : machine.status === 'degraded' ? 'Degraded' : 'Online';
  return <button type="button" disabled={offline || disabled} onClick={onSelect} className="hv-sub" style={{
    display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 10px', border: '1px solid var(--line-card)',
    borderRadius: 8, background: 'var(--bg-raised)', color: 'var(--text-label)', textAlign: 'left',
    font: 'inherit', cursor: offline || disabled ? 'not-allowed' : 'pointer', opacity: offline ? 0.6 : 1,
  }}>
    <Icon size={17} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
    <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>{machine.name}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 10.5 }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: offline ? 'var(--accent-red)' : machine.status === 'degraded' ? 'var(--accent-amber)' : 'var(--accent-mint)' }} />
        {statusText}
      </span>
    </span>
  </button>;
}

function messageFor(code: string): string {
  if (code === 'fs.invalid_path') return 'Choose an absolute folder path.';
  if (code === 'fs.not_found') return "Can't open this folder: it can't be found.";
  if (code === 'fs.not_directory') return "Can't open this folder: that path isn't a folder.";
  if (code === 'fs.denied') return "Can't open this folder: permission denied.";
  if (code === 'machine.unreachable') return "This machine isn't available right now.";
  return 'Could not add this project.';
}

const scrim: CSSProperties = { position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', padding: 20, background: 'var(--modal-scrim)' };
const dialogStyle: CSSProperties = { width: 'min(440px, 100%)', maxHeight: '85vh', overflow: 'auto', padding: 20, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--line-card)', color: 'var(--text-active)', boxShadow: '0 16px 48px var(--shadow-color)' };
const header: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 };
const hint: CSSProperties = { marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' };
const footer: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: 14 };
const status: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: 'var(--text-secondary)', fontSize: 12 };
const errorStyle: CSSProperties = { padding: 10, color: 'var(--accent-red)', fontSize: 12 };
const iconButton: CSSProperties = { display: 'grid', placeItems: 'center', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-hint)', cursor: 'pointer' };
