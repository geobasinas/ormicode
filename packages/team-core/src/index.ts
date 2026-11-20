export * from './board.ts';

export interface TeamLimits { children: number; childrenMax: number; depth: number; concurrent: number; maxTeams: number }
export function teamLimits(read: (key: string) => unknown): TeamLimits {
  const positive = (key: string, fallback: number) => {
    const value = read(`team.${key}`);
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  const childrenMax = Math.min(8, positive('childrenMax', 8));
  return {
    children: Math.min(childrenMax, positive('children', 4)), childrenMax,
    depth: positive('depth', 2), concurrent: positive('concurrent', 3), maxTeams: positive('maxTeams', 3),
  };
}
export function spawnLimit(limits: TeamLimits, counts: { children: number; running: number; depth: number; teams: number; newTeam: boolean }): string | undefined {
  if (counts.children >= limits.children) return 'child limit reached';
  if (counts.running >= limits.concurrent) return 'concurrent child limit reached';
  if (counts.depth > limits.depth) return 'team depth limit reached';
  if (counts.newTeam && counts.teams >= limits.maxTeams) return 'active team limit reached';
  return undefined;
}
const shared = new Set(['team.message', 'team.inbox', 'team.board', 'team.close']);
export function teamPermission(method: string, parent: string, actor: string, target?: string, action?: string): boolean {
  if (actor === parent) return true;
  if (!shared.has(method)) return false;
  if (method === 'team.board' && action === 'setState') return false;
  return method !== 'team.close' || target === actor;
}
