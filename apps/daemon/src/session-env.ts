import type { SessionRow } from '@ormicode/session-store';

export interface SessionEnvironmentInput {
  session: string;
  project: string;
  cwd: string;
  worktree?: string | null;
  branch?: string | null;
  base: number;
}

export function sessionEnvironment(input: SessionEnvironmentInput): Record<string, string> {
  const projectRoot = input.project === 'scratch' ? input.cwd : input.project;
  return {
    PORT: String(input.base),
    ORMI_PORT: String(input.base),
    ORMI_PORTS: `${input.base}-${input.base + 9}`,
    ORMI_SESSION: input.session,
    ORMI_WORKTREE: input.worktree || input.cwd,
    ORMI_PROJECT_ROOT: projectRoot,
    ORMI_BRANCH: input.branch ?? '',
  };
}

export function environmentForSession(session: SessionRow, base: number): Record<string, string> {
  return sessionEnvironment({
    session: session.id, project: session.project, cwd: session.cwd,
    worktree: session.worktree, branch: session.branch, base,
  });
}
