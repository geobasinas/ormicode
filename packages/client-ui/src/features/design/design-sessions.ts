/** Linked-session choices for the open design project. Worktrees of that project stay; other projects do not. */
export function sessionsForDesignProject<T extends { project: string }>(sessions: readonly T[], project: string): T[] {
  return project && project !== 'scratch' ? sessions.filter(item => item.project === project) : [];
}
