/** New-session composer card: prompt + project/machine/agent chips → session.start.
 *  Enter sends, Shift+Enter newline; the textarea grows with the prompt. */
import { useEffect, useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, ChevronDown, Folder, Laptop, Loader2, FileText, X } from 'lucide-react';
import { newId } from '@ormicode/protocol';
import type { PromptContext } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { useImages, useFiles, ImageStrip, ProjectChip, ModeChip, effectiveMode, iconBtn, type ModeChoice } from './composer-parts.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.tsx';
import { AgentChip, GitChip, branchNameIssue, type RepoInfo, type WorkspaceChoice, type WorkspaceMode } from './pickers.tsx';
import { useModels } from './useModels.ts';
import { useComposerDraft } from './useComposerDraft.ts';
import { useProjects } from '../projects/useProjects.ts';

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
const FALLBACK: Agent[] = ['claude', 'codex', 'opencode', 'pi', 'grok', 'vibe'].map(vendor => ({ vendor, transports: ['cli'] }));

export function NewSession({ onStarted }: { onStarted: (session: string) => void }) {
  const { transport, desktop } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const { text, setText } = useComposerDraft('home');
  const [context, setContext] = useState<PromptContext[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionItems, setMentionItems] = useState<{ label: string; context: PromptContext }[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRange = useRef<{ start: number; end: number } | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  const [vendor, setVendor] = useState('claude');
  const [project, setProject] = useState('scratch');
  const { projects: registeredProjects } = useProjects();
  const [projects, setProjects] = useState<string[]>([]);
  const [branchPrefix] = useState('ormi/');
  const [branchName, setBranchName] = useState(() => branchNameFor('', 'ormi/'));
  const branchNameEdited = useRef(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('local');
  const [agents, setAgents] = useState<Agent[]>(FALLBACK);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [via, setVia] = useState<string>();
  const [model, setModel] = useState('default');
  const [effort, setEffort] = useState('default');
  const [mode, setMode] = useState<string>();
  const [modes, setModes] = useState<ModeChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ kind: 'current' });
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [repoLoading, setRepoLoading] = useState(project !== 'scratch');
  const projectRef = useRef(project);
  projectRef.current = project;
  const img = useImages();
  const files = useFiles();
  useEffect(() => {
    if (!mentionOpen) return;
    const specials: { label: string; context: PromptContext }[] = [
      { label: 'Diff', context: { kind: 'diff' } }, { label: 'Terminal', context: { kind: 'terminal' } }, { label: 'Notes', context: { kind: 'notes' } },
    ];
    let active = true;
    void transport.request('project.searchFiles', { project, query: mentionQuery, limit: 100 }).then(res => {
      const files = res.type === 'res' ? (res.body as { files: { path: string; kind: 'file' | 'folder' }[] }).files : [];
      if (active) { setMentionItems([...specials, ...files.map(file => ({ label: file.path, context: { kind: file.kind, path: file.path } as PromptContext }))].filter(item => item.label.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 100)); setMentionIndex(0); }
    }).catch(() => { if (active) setMentionItems(specials); });
    return () => { active = false; };
  }, [mentionOpen, mentionQuery, project, transport]);
  const openMention = () => { const caret = area.current?.selectionStart ?? text.length; mentionRange.current = { start: caret, end: caret }; setMentionQuery(''); setMentionOpen(true); };
  const chooseMention = (item: { label: string; context: PromptContext }) => {
    const range = mentionRange.current ?? { start: text.length, end: text.length };
    setText(`${text.slice(0, range.start)}@${item.label} ${text.slice(range.end)}`);
    setContext(current => [...current, item.context]); setMentionOpen(false); area.current?.focus();
  };
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
  // Pre-start mode enumeration (agents.modes): only vendors whose modes don't
  // require a live session answer — the rest populate the session chip instead.
  useEffect(() => {
    if (!agentsLoaded) return;
    let alive = true;
    transport.request('agents.modes', { agent: vendor, transport: chosen, ...(project !== 'scratch' ? { cwd: project } : {}) })
      .then(r => { if (alive && r.type === 'res') setModes((r.body as unknown as { modes: ModeChoice[] }).modes ?? []); })
      .catch(() => { if (alive) setModes([]); });
    return () => { alive = false; };
  }, [vendor, chosen, project, agentsLoaded, transport]);
  // A mode belongs to one vendor: drop the pick when the list no longer has it.
  useEffect(() => { setMode(current => current && modes.some(m => m.id === current) ? current : undefined); }, [modes]);
  const startMode = effectiveMode(modes, mode);
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
        model, effort, mode: startMode && !startMode.default ? startMode.id : 'default',
        ...(context.length ? { context } : {}),
        ...(files.wire.length ? { attachments: files.wire } : {}),
        workspace: project === 'scratch' ? { kind: 'scratch' }
          : workspace.kind === 'worktree' ? { ...workspace, name: branchName.trim() || branchNameFor(t, branchPrefix) }
            : workspace.kind === 'branch' ? { ...workspace, branch: branchName.trim() || branchNameFor(t, branchPrefix) } : workspace,
      });
      if (res.type === 'err') { setError(workspaceError(res.code, res.message)); setBusy(false); return; }
      const session = (res.body as { session: string }).session;
      const images = img.wire.length ? img.wire : undefined;
      setText(''); setContext([]); img.clear(); files.clear(); grow();
      void transport.request('session.prompt', { session, text: t, ...(images ? { images } : {}) });
      onStarted(session);
    } catch (e) { setError(String(e)); setBusy(false); }
  };

  return (
    <div onDragOver={event => { event.preventDefault(); setDropping(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropping(false); }} onDrop={event => { event.preventDefault(); setDropping(false); const all = [...event.dataTransfer.files]; void img.add(all.filter(file => file.type.startsWith('image/'))); void files.add(all.filter(file => !file.type.startsWith('image/'))); }} style={{
      background: 'var(--bg-card)', border: '1px solid var(--line-card)', borderRadius: 12,
      padding: '11px 14px 10px', width: '100%', position: 'relative',
    }}>
      {img.picker}
      {files.picker}
      <ImageStrip images={img.images} onRemove={img.remove} />
      {files.files.length ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '2px 0 6px' }}>{files.files.map((file, index) => <span key={`${file.name}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 190, fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderRadius: 5, padding: '3px 5px' }}><FileText size={11} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name} · {Math.ceil(file.size / 1024)} KB</span><button onClick={() => files.remove(index)} style={iconBtn}><X size={10} /></button></span>)}</div> : null}
      {context.length ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>{context.map((entry, i) => <span key={i} style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--bg-inset)', color: 'var(--text-hint)', fontSize: 10 }}>@{entry.path ?? (entry.kind === 'diff' ? 'Diff' : entry.kind === 'terminal' ? 'Terminal' : 'Notes')}</span>)}</div> : null}
      <textarea
        className="ormi-composer-input"
        ref={area}
        onPaste={event => { const all = [...event.clipboardData.files]; if (all.length) { event.preventDefault(); void img.add(all.filter(file => file.type.startsWith('image/'))); void files.add(all.filter(file => !file.type.startsWith('image/'))); } }}
        value={text}
        onChange={e => { const value = e.target.value; setText(value); grow(); setContext(current => current.filter(entry => value.includes(`@${entry.path ?? (entry.kind === 'diff' ? 'Diff' : entry.kind === 'terminal' ? 'Terminal' : 'Notes')}`))); const match = /(^|\s)@([^\s]*)$/.exec(value.slice(0, e.target.selectionStart)); if (match) { mentionRange.current = { start: e.target.selectionStart - match[2]!.length - 1, end: e.target.selectionStart }; setMentionQuery(match[2]!); setMentionOpen(true); } else setMentionOpen(false); }}
        onKeyDown={e => {
          if (mentionOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && mentionItems.length) { e.preventDefault(); setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : mentionItems.length - 1)) % mentionItems.length); }
          else if (mentionOpen && (e.key === 'Enter' || e.key === 'Tab') && mentionItems.length) { e.preventDefault(); chooseMention(mentionItems[mentionIndex]!); }
          else if (mentionOpen && e.key === 'Escape') setMentionOpen(false);
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
        }}
        placeholder="What do you want to work on?" rows={1}
        style={{
          width: '100%', resize: 'none', font: 'inherit', fontSize: 13, lineHeight: 1.5,
          background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)',
          minHeight: 42, maxHeight: 168, overflow: 'hidden',
        }}
      />
      {preparingWorktree ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-hint)', fontSize: 11, marginBottom: 4 }}><Loader2 size={12} className="animate-spin" />Preparing worktree…</div> : null}
      {busyHint && !preparingWorktree ? <div style={{ color: 'var(--text-hint)', fontSize: 11, marginBottom: 4 }}>{busyHint}</div> : null}
      {error || img.error || files.error || detachedBlocked ? <div style={{ color: 'var(--accent-red)', fontSize: 'var(--text-xs)', marginBottom: 4, whiteSpace: 'pre-wrap' }}>{error ?? img.error ?? files.error ?? 'HEAD is detached — pick a new branch or a worktree'}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <DropdownMenu><DropdownMenuTrigger asChild><button className="hv-sub" style={iconBtn} title="attach" aria-label="attach"><Plus size={17} /></button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => img.pick()}>Images…</DropdownMenuItem><DropdownMenuItem onSelect={() => files.pick()}>Files…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <button style={iconBtn} title="Mention files or context" onClick={openMention}><AtSign size={16} /></button>
        <button style={{ ...iconBtn, color: 'var(--text-hint)', cursor: 'default' }} title="voice (soon)" disabled><Mic size={16} /></button>
        <span style={{ flex: 1 }} />
        <ProjectChip title="project folder or 'scratch'" icon={<Folder size={12} style={{ color: 'var(--text-hint)' }} />}
          value={project} projects={registeredProjects.map(project => project.path)}
          onChange={setProject}
          onBrowse={async () => {
            const picked = await desktop?.pickFolder().catch(() => null) ?? null;
            if (picked) setProject(picked);
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
        {modes.length ? <ModeChip modes={modes} value={mode} onChange={setMode} /> : null}
        <button onClick={() => void send()} disabled={!text.trim() || busy || detachedBlocked || repoLoading || branchNameInvalid} title={detachedBlocked ? 'HEAD is detached — pick a new branch or a worktree' : repoLoading ? 'Loading Git branches…' : branchNameInvalid ? 'Enter a valid new branch name' : 'start session'} style={{
          width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2,
          background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() && !detachedBlocked && !repoLoading && !branchNameInvalid ? 1 : 0.5,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{preparingWorktree ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} strokeWidth={2.5} />}</button>
      </div>
      {mentionOpen ? <div style={{ position: 'absolute', left: 22, bottom: 52, width: 280, maxHeight: 220, overflowY: 'auto', zIndex: 20, background: 'var(--bg-raised)', border: '1px solid var(--line-card)', borderRadius: 8, boxShadow: 'var(--shadow-md)', padding: 4 }}>{mentionItems.map((item, index) => <button key={`${item.context.kind}-${item.label}`} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(item)} style={{ width: '100%', border: 0, borderRadius: 5, background: index === mentionIndex ? 'var(--bg-selected)' : 'transparent', color: index === mentionIndex ? 'var(--text-active)' : 'var(--text-secondary)', textAlign: 'left', padding: '5px 7px', fontSize: 11, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</button>)}</div> : null}
      {dropping ? <div style={{ position: 'absolute', inset: 4, border: '1px dashed var(--line-card)', borderRadius: 9, background: 'var(--bg-selected)', display: 'grid', placeItems: 'center', color: 'var(--text-label)', fontSize: 12, pointerEvents: 'none' }}>Drop to attach</div> : null}
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
