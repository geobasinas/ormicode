import type { SessionSummary } from '../session/useSessions.ts';
import type { ProjectSummary } from './useProjects.ts';
import { sessionForest } from '../session/team-tree.ts';

export interface ProjectGroup {
  project: string;
  name: string;
  sessions: SessionSummary[];
  addedAt?: number;
}

const needsYou = new Set(['awaiting_approval', 'awaiting_input', 'interrupted', 'failed', 'paused_rate_limited']);
const live = new Set(['running', 'starting', 'retrying']);
const rank = (session: SessionSummary) => needsYou.has(session.state) ? 0 : live.has(session.state) ? 1 : 2;
const projectMatch = (project: ProjectSummary, query: string) => `${project.name} ${project.path}`.toLowerCase().includes(query);

export function groupSessionProjects(sessions: SessionSummary[], projects: ProjectSummary[], query?: string) {
  return groupProjects(sessions, projects, query).map(group => {
    const project = projects.find(project => project.path === group.project);
    const projectMatches = project && projectMatch(project, query?.trim().toLowerCase() ?? '');
    const nodes = sessionForest(sessions.filter(session => session.project === group.project), projectMatches ? '' : query);
    return { ...group, nodes };
  });
}

export function groupProjects(sessions: SessionSummary[], projects: ProjectSummary[], query?: string): ProjectGroup[] {
  const q = query?.trim().toLowerCase() ?? '';
  const registered = new Map(projects.map(project => [project.path, project]));
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    if (session.state === 'archived') continue;
    const project = registered.get(session.project);
    const text = `${session.title ?? ''} ${session.project} ${session.vendor ?? ''} ${session.branch ?? ''}`.toLowerCase();
    if (q && !text.includes(q) && !(project && projectMatch(project, q))) continue;
    const group = groups.get(session.project) ?? [];
    group.push(session);
    groups.set(session.project, group);
  }
  for (const group of groups.values())
    group.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const latest = (group: SessionSummary[]) => Math.max(...group.map(session => session.updatedAt ?? 0));
  const populated = [...groups.entries()].filter(([path]) => path !== 'scratch')
    .map(([path, items]) => ({
      project: path, name: registered.get(path)?.name ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, sessions: items,
    }))
    .sort((a, b) => latest(b.sessions) - latest(a.sessions));
  const empty = projects.filter(project => !groups.has(project.path) && (!q || projectMatch(project, q)))
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(project => ({ project: project.path, name: project.name, sessions: [], addedAt: project.addedAt }));
  const scratch = groups.get('scratch');
  return [...populated, ...empty, ...(scratch ? [{ project: 'scratch', name: 'No project', sessions: scratch }] : [])];
}
