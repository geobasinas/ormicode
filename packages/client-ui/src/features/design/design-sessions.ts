/** Linked-session choices for the open design board. Sessions sharing the board's canvas root
 * stay — same project (incl. its worktrees), or the same scratch folder for no-project sessions. */
export function sessionsForDesignProject<T extends { project: string; cwd?: string }>(sessions: readonly T[], project: string | undefined, cwd?: string): T[] {
  if (project && project !== 'scratch') return sessions.filter(item => item.project === project);
  return cwd ? sessions.filter(item => item.project === 'scratch' && item.cwd === cwd) : [];
}
