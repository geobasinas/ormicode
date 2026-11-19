/** New-session composer card: prompt + project/machine/agent chips → session.start.
 *  Enter sends, Shift+Enter newline; the textarea grows with the prompt. */
import { useEffect, useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown, Folder, Laptop, Loader2 } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { VENDORS, loadPrefs, rememberProject } from '../../routes/Settings.tsx';
import { useImages, ImageStrip, ProjectChip, iconBtn } from './composer-parts.tsx';
import { AgentChip, GitChip, branchNameIssue, type RepoInfo, type WorkspaceChoice, type WorkspaceMode } from './pickers.tsx';
import { useModels } from './useModels.ts';

const chip = {
  font: 'inherit', fontSize: 11, fontWeight: 500, color: 'var(--text-title)',
  background: 'var(--bg-chip)', border: 'none',
  borderRadius: 7, padding: '0 8px', height: 24, display: 'inline-flex', alignItems: 'center', gap: 6,
};
const workspaceModeKey = (project: string) => `ormi.workspaceMode:${project}`;
function savedWorkspaceMode(project: string): WorkspaceMode {
  try {
    const saved = globalThis.localStorage?.getItem(workspaceModeKey(project));
    return saved === 'worktree' || saved === 'branch' ? saved : 'local';
  } catch { return 'local'; }
}
function rememberWorkspaceMode(project: string, mode: WorkspaceMode) {
  try { globalThis.localStorage?.setItem(workspaceModeKey(project), mode); } catch { /* private mode */ }
}
function branchNameFor(prompt: string, prefix: string) {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${prefix}${slug || 'task'}`;
}
type Agent = { vendor: string; transports: string[] };
const FALLBACK: Agent[] = VENDORS.map(vendor => ({ vendor, transports: ['cli'] }));

export function NewSession({ onStarted }: { onStarted: (session: string) => void }) {
  const { transport, desktop } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [vendor, setVendor] = useState(() => loadPrefs().defaultVendor);
  const [project, setProject] = useState(() => loadPrefs().defaultProject);
  const [projects, setProjects] = useState<string[]>(() => loadPrefs().projects ?? []);
  const [branchPrefix] = useState(() => loadPrefs().worktreeBranchPrefix ?? 'ormi/');
  const [branchName, setBranchName] = useState(() => branchNameFor('', loadPrefs().worktreeBranchPrefix ?? 'ormi/'));
  const branchNameEdited = useRef(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('local');
  const [agents, setAgents] = useState<Agent[]>(FALLBACK);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [via, setVia] = useState<string>();
  const [model, setModel] = useState('default');
  const [effort, setEffort] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ kind: 'current' });
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [repoLoading, setRepoLoading] = useState(project !== 'scratch');
  const projectRef = useRef(project);
  projectRef.current = project;
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
    if (project === 'scratch') { setRepoLoading(false); setWorkspaceMode('local'); return; }
    let alive = true;
    setRepoLoading(true);
    transport.request('project.branches', { project }).then(r => {
      if (!alive) return;
      setRepoLoading(false);
      if (r.type !== 'res') return;
      const b = r.body as unknown as { isRepo: boolean } & RepoInfo;
      if (!b.isRepo) return;
      setRepo(b);
      const currentBusy = Boolean(b.current && b.busyBranches.includes(b.current));
      const nextMode = b.detached || currentBusy ? 'worktree' : savedWorkspaceMode(project);
      setWorkspaceMode(nextMode);
      if (b.detached || currentBusy) rememberWorkspaceMode(project, nextMode);
      const base = currentBusy ? b.current : b.defaultBranch ?? b.current ?? b.local[0]?.name;
      if (nextMode === 'worktree' && base) setWorkspace({ kind: 'worktree', branch: base, name: branchName });
      else if (nextMode === 'branch') setWorkspace({ kind: 'branch', branch: branchName });
    }).catch(() => { if (alive) setRepoLoading(false); });
    return () => { alive = false; };
  }, [transport, project]);
  useEffect(() => {
    if (!branchNameEdited.current) {
      const name = branchNameFor(text, branchPrefix);
      setBranchName(name);
      setWorkspace(current => current.kind === 'branch' ? { kind: 'branch', branch: name } : current);
    }
  }, [text, branchPrefix]);
  useEffect(() => {
    branchNameEdited.current = false;
    setBranchName(branchNameFor(text, branchPrefix));
  }, [project, branchPrefix]);
  const refreshRepo = async () => {
    const path = projectRef.current;
    if (path === 'scratch') return;
    setRepoLoading(true);
    try {
      const r = await transport.request('project.branches', { project: path });
      if (projectRef.current !== path || r.type !== 'res') return;
      const b = r.body as unknown as { isRepo: boolean } & RepoInfo;
      setRepo(b.isRepo ? b : null);
      const currentBusy = Boolean(b.current && b.busyBranches.includes(b.current));
      if (b.isRepo && ((b.detached && workspace.kind === 'current')
        || (currentBusy && workspaceMode !== 'worktree' && (workspace.kind === 'current' || workspace.kind === 'branch')))) {
        setWorkspaceMode('worktree');
        rememberWorkspaceMode(path, 'worktree');
        const base = currentBusy ? b.current : b.defaultBranch ?? b.local[0]?.name;
        if (base) setWorkspace({ kind: 'worktree', branch: base, name: branchName });
      }
    } catch { /* unavailable until the next menu open */ }
    finally { if (projectRef.current === path) setRepoLoading(false); }
  };
  const transports = agents.find(a => a.vendor === vendor)?.transports ?? ['cli'];
  const chosen = via && transports.includes(via) ? via : transports[0]!;
  const modelList = useModels(vendor, agentsLoaded ? chosen : undefined);
  const detachedBlocked = Boolean(repo?.detached && workspace.kind === 'current');
  const branchNameInvalid = Boolean(repo && (workspace.kind === 'branch' || workspace.kind === 'worktree') && branchNameIssue(branchName, repo));
  const currentBusy = Boolean(repo?.current && repo.busyBranches.includes(repo.current));
  const busyHint = repo && currentBusy && workspaceMode === 'worktree' && workspace.kind === 'worktree' && workspace.branch === repo.current
    ? `${repo.current} is in use by another session — starting in a new worktree` : undefined;
  const preparingWorktree = busy && workspace.kind === 'worktree';
  const chooseMode = (next: WorkspaceMode) => {
    if (next === 'local' && (repo?.detached || currentBusy)) return;
    if (next === 'branch' && currentBusy) return;
    setWorkspaceMode(next);
    rememberWorkspaceMode(project, next);
    if (next === 'local') setWorkspace({ kind: 'current' });
    else if (next === 'branch') setWorkspace({ kind: 'branch', branch: branchName });
    else {
      const base = repo?.defaultBranch ?? repo?.current ?? repo?.local[0]?.name;
      if (base) setWorkspace({ kind: 'worktree', branch: base, name: branchName });
    }
  };
  const chooseWorkspace = (choice: WorkspaceChoice) => {
    if (choice.kind === 'current' && (repo?.detached || currentBusy)) {
      if (repo?.detached) { setWorkspaceMode('worktree'); rememberWorkspaceMode(project, 'worktree'); }
      const base = repo?.current ?? repo?.defaultBranch ?? repo?.local[0]?.name;
      if (base) setWorkspace({ kind: 'worktree', branch: base, name: branchName });
      return;
    }
    if (choice.kind === 'existing' || choice.kind === 'worktree') {
      setWorkspaceMode('worktree');
      rememberWorkspaceMode(project, 'worktree');
      setWorkspace(choice.kind === 'worktree' ? { ...choice, name: branchName } : choice);
    } else if (choice.kind === 'branch') {
      if (currentBusy) {
        setWorkspaceMode('worktree');
        rememberWorkspaceMode(project, 'worktree');
        const base = repo?.current ?? repo?.defaultBranch ?? repo?.local[0]?.name;
        if (base) setWorkspace({ kind: 'worktree', branch: base, name: branchName });
        return;
      }
      setWorkspaceMode('branch');
      rememberWorkspaceMode(project, 'branch');
      setWorkspace(choice);
    } else {
      setWorkspaceMode('local');
      rememberWorkspaceMode(project, 'local');
      setWorkspace(choice);
    }
  };
  const fetchRepo = async () => {
    setError(undefined);
    setRepoLoading(true);
    try {
      const fetched = await transport.request('project.fetch', { project }).catch(() => undefined);
      if (fetched?.type === 'res' && (fetched.body as { ok: boolean }).ok) await refreshRepo();
      else setError(fetched?.type === 'res' ? (fetched.body as { error?: string }).error ?? 'Git fetch failed' : 'Git fetch failed');
    } finally { setRepoLoading(false); }
  };
  const projectBranchAction = async (
    method: 'project.pull' | 'project.renameBranch' | 'project.deleteBranch', body: Record<string, unknown>,
  ): Promise<{ updated?: boolean; from?: string; to?: string }> => {
    try {
      const response = await transport.request(method, body);
      if (response.type === 'err') throw new Error(`${response.code}: ${response.message}`);
      return response.body as { updated?: boolean; from?: string; to?: string };
    } finally { await refreshRepo(); }
  };

  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy || repoLoading || detachedBlocked || branchNameInvalid) return;
    setBusy(true); setError(undefined);
    try {
      const res = await transport.request('session.start', {
        machine: newId('m'), project, vendor, transport: chosen,
        model, effort, mode: 'default',
        workspace: project === 'scratch' ? { kind: 'scratch' }
          : workspace.kind === 'worktree' ? { ...workspace, name: branchName.trim() || branchNameFor(t, branchPrefix) }
            : workspace.kind === 'branch' ? { ...workspace, branch: branchName.trim() || branchNameFor(t, branchPrefix) } : workspace,
      });
      if (res.type === 'err') { setError(workspaceError(res.code, res.message)); setBusy(false); return; }
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
      {preparingWorktree ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-hint)', fontSize: 11, marginBottom: 4 }}><Loader2 size={12} className="animate-spin" />Preparing worktree…</div> : null}
      {busyHint && !preparingWorktree ? <div style={{ color: 'var(--text-hint)', fontSize: 11, marginBottom: 4 }}>{busyHint}</div> : null}
      {error || img.error || detachedBlocked ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)', marginBottom: 4, whiteSpace: 'pre-wrap' }}>{error ?? img.error ?? 'HEAD is detached — pick a new branch or a worktree'}</div> : null}
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
        {repo ? <GitChip title="choose a local branch or worktree" project={project}
          value={workspace} onChange={chooseWorkspace} info={repo} mode={workspaceMode} onModeChange={chooseMode}
          branchName={branchName} onBranchNameChange={name => {
            branchNameEdited.current = true; setBranchName(name);
            if (workspace.kind === 'branch') setWorkspace({ ...workspace, branch: name });
          }}
          onOpen={refreshRepo} onFetch={fetchRepo} onProjectAction={projectBranchAction} /> : null}
        <span style={chip} title="this machine"><Laptop size={12} style={{ color: 'var(--text-hint)' }} />local<ChevronDown size={12} style={{ color: 'var(--text-hint)' }} /></span>
        <AgentChip title="agent, transport, model and effort"
          vendor={vendor} via={chosen} agents={agents}
          onPick={(v, t) => { setVendor(v); setVia(t); }}
          model={model} models={modelList.models} onModel={setModel}
          effort={effort} onEffort={setEffort}
          loading={modelList.loading} refresh={modelList.refresh} />
        <button onClick={() => void send()} disabled={!text.trim() || busy || detachedBlocked || repoLoading || branchNameInvalid} title={detachedBlocked ? 'HEAD is detached — pick a new branch or a worktree' : repoLoading ? 'Loading Git branches…' : branchNameInvalid ? 'Enter a valid new branch name' : 'start session'} style={{
          width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2,
          background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() && !detachedBlocked && !repoLoading && !branchNameInvalid ? 1 : 0.5,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{preparingWorktree ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} strokeWidth={2.5} />}</button>
      </div>
    </div>
  );
}

function workspaceError(code: string, message: string) {
  if (code === 'workspace.detached') return 'HEAD is detached — pick a new branch or a worktree';
  if (code === 'workspace.busy') return `Cannot switch the main checkout: ${message}`;
  if (code === 'workspace.dirty_conflict') return `Uncommitted changes conflict with that branch: ${message}`;
  if (code === 'workspace.branch_exists') return message;
  if (code === 'workspace.not_repo') return 'This folder is not a Git repository. Choose a Git project or use the current workspace.';
  if (code === 'workspace.failed') return message;
  if (code === 'workspace.setup_failed') {
    const lines = message.split(/\r?\n/);
    const output = lines.slice(1).filter(Boolean).slice(0, 3);
    return `Worktree setup failed${output.length ? `:\n${output.join('\n')}` : `: ${lines[0] ?? message}`}`;
  }
  if (code === 'lease.conflict') return 'This workspace is already in use by another session. Choose a different workspace.';
  return message;
}
