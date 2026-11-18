/** New-session composer card: prompt + project/machine/agent chips → session.start.
 *  Enter sends, Shift+Enter newline; the textarea grows with the prompt. */
import { useEffect, useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown, Folder, Laptop, Bot, GitBranch } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { VENDORS, loadPrefs, rememberProject } from '../../routes/Settings.tsx';
import { useImages, ImageStrip, ProjectChip, iconBtn } from './composer-parts.tsx';
import { AgentChip, GitChip, type RepoInfo, type WorkspaceChoice } from './pickers.tsx';
import { useModels } from './useModels.ts';

const chip = {
  font: 'inherit', fontSize: 11, fontWeight: 500, color: 'var(--text-title)',
  background: 'var(--bg-chip)', border: 'none',
  borderRadius: 7, padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 6,
};
type Agent = { vendor: string; transports: string[] };
const FALLBACK: Agent[] = VENDORS.map(vendor => ({ vendor, transports: ['cli'] }));

export function NewSession({ onStarted }: { onStarted: (session: string) => void }) {
  const { transport, desktop } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [vendor, setVendor] = useState(() => loadPrefs().defaultVendor);
  const [project, setProject] = useState(() => loadPrefs().defaultProject);
  const [projects, setProjects] = useState<string[]>(() => loadPrefs().projects ?? []);
  const [agents, setAgents] = useState<Agent[]>(FALLBACK);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [via, setVia] = useState<string>();
  const [model, setModel] = useState('default');
  const [effort, setEffort] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ kind: 'current' });
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const img = useImages();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    // agentsLoaded flips only on a successful reply — a failed call (daemon
    // down) keeps the fallback agents for display and retries until it lands.
    const fetch = () => transport.request('agents.list', {}).then(r => {
      if (!alive) return;
      if (r.type === 'res') {
        setAgents((r.body as unknown as { agents: Agent[] }).agents);
        setAgentsLoaded(true);
        if (timer) { clearInterval(timer); timer = undefined; }
      }
    }).catch(() => {});
    fetch();
    timer = setInterval(fetch, 15_000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [transport]);
  useEffect(() => {
    transport.request('session.list', {}).then(r => {
      if (r.type !== 'res') return;
      const seen = ((r.body as { sessions: { project: string }[] }).sessions ?? []).map(s => s.project);
      setProjects(cur => [...new Map([...cur, ...seen.filter(p => p !== 'scratch')].map(p => [p.replace(/\\/g, '/').toLowerCase(), p])).values()]);
    }).catch(() => {});
  }, [transport]);
  useEffect(() => {
    setWorkspace({ kind: 'current' });
    setRepo(null);
    if (project === 'scratch') return;
    let alive = true;
    transport.request('project.branches', { project }).then(r => {
      if (!alive || r.type !== 'res') return;
      const b = r.body as { isRepo: boolean; current: string | null; local: { name: string }[] };
      if (b.isRepo) setRepo({ current: b.current, local: b.local });
    }).catch(() => {});
    return () => { alive = false; };
  }, [transport, project]);
  const transports = agents.find(a => a.vendor === vendor)?.transports ?? ['cli'];
  const chosen = via && transports.includes(via) ? via : transports[0]!;
  const modelList = useModels(vendor, agentsLoaded ? chosen : undefined);

  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(undefined);
    try {
      const res = await transport.request('session.start', {
        machine: newId('m'), project, vendor, transport: chosen,
        model, effort, mode: 'default',
        workspace: project === 'scratch' ? { kind: 'scratch' } : workspace,
      });
      if (res.type === 'err') { setError(res.message); setBusy(false); return; }
      const session = (res.body as { session: string }).session;
      const images = img.wire.length ? img.wire : undefined;
      setText(''); img.clear(); grow();
      void transport.request('session.prompt', { session, text: t, ...(images ? { images } : {}) });
      onStarted(session);
    } catch (e) { setError(String(e)); setBusy(false); }
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 12,
      padding: '11px 14px 10px', width: '100%',
    }}>
      {img.picker}
      <ImageStrip images={img.images} onRemove={img.remove} />
      <textarea
        ref={area}
        onPaste={img.onPaste}
        value={text}
        onChange={e => { setText(e.target.value); grow(); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        placeholder="What do you want to work on?" rows={1}
        style={{
          width: '100%', resize: 'none', font: 'inherit', fontSize: 13, lineHeight: 1.5,
          background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)',
          minHeight: 42, maxHeight: 168, overflow: 'hidden',
        }}
      />
      {error || img.error ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>{error ?? img.error}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="hv-sub" style={iconBtn} title="attach images" aria-label="attach images" onClick={img.pick}><Plus size={17} /></button>
        <button style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }} title="mention files (soon)" disabled><AtSign size={16} /></button>
        <button style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }} title="voice (soon)" disabled><Mic size={16} /></button>
        <span style={{ flex: 1 }} />
        <ProjectChip title="project folder or 'scratch'" icon={<Folder size={12} style={{ color: 'var(--text-hint)' }} />}
          value={project} projects={projects}
          onChange={v => { setProject(v); if (v !== 'scratch') { rememberProject(v); setProjects(loadPrefs().projects ?? []); } }}
          onBrowse={async () => {
            const picked = await desktop?.pickFolder().catch(() => null) ?? null;
            if (picked) { setProject(picked); rememberProject(picked); setProjects(loadPrefs().projects ?? []); }
            return picked;
          }} />
        <span style={chip} title="this machine"><Laptop size={12} style={{ color: 'var(--text-hint)' }} />local<ChevronDown size={12} style={{ color: 'var(--text-hint)' }} /></span>
        <AgentChip title="agent, transport, model and effort"
          icon={<Bot size={11} style={{ color: 'var(--text-hint)' }} />}
          vendor={vendor} via={chosen} agents={agents}
          onPick={(v, t) => { setVendor(v); setVia(t); }}
          model={model} models={modelList.models} onModel={setModel}
          effort={effort} onEffort={setEffort}
          loading={modelList.loading} refresh={modelList.refresh} />
        {repo ? <GitChip title="where the agent works" icon={<GitBranch size={12} style={{ color: 'var(--text-hint)' }} />}
          value={workspace} onChange={setWorkspace} info={repo} /> : null}
        <button onClick={() => void send()} disabled={!text.trim() || busy} title="start session" style={{
          width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2,
          background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.5,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ArrowUp size={15} strokeWidth={2.5} /></button>
      </div>
    </div>
  );
}
