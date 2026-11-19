import { findWorkspaceHook, runWorkspaceHook } from '@ormicode/git-core';
import type { SessionRow } from '@ormicode/session-store';
import { sessionEnvironment } from './session-env.ts';

type HookStep = 'resume' | 'teardown';
type HookRecord = (session: string, kind: string, payload: Record<string, unknown>) => void;
type HookSession = Pick<SessionRow, 'id' | 'project' | 'cwd' | 'worktree' | 'branch'>;

export async function runSessionHook(
  row: HookSession, step: HookStep, base: number, record: HookRecord, journalSession = row.id,
): Promise<void> {
  const file = findWorkspaceHook([row.cwd, row.project], step);
  if (!file) {
    if (step === 'teardown') record(journalSession, 'workspace_step', { step, status: 'skipped', detail: `.ormi/${step} not found` });
    return;
  }
  try {
    const result = await runWorkspaceHook(
      file, row.cwd,
      sessionEnvironment({
        session: row.id, project: row.project, cwd: row.cwd,
        worktree: row.worktree, branch: row.branch, base,
      }),
      120_000, 8192,
    );
    const output = result.output.toString('utf8');
    const status = result.code === 0 && !result.timedOut && !result.error ? 'ok' : 'warn';
    const detail = result.timedOut ? 'timed out after 120 seconds'
      : result.error?.message ?? (result.code === 0 ? undefined : `exited with code ${result.code ?? 'unknown'}`);
    record(journalSession, 'workspace_step', { step, status, ...(detail ? { detail } : {}), ...(output ? { output } : {}) });
  } catch (error) {
    record(journalSession, 'workspace_step', {
      step, status: 'warn', detail: error instanceof Error ? error.message : String(error),
    });
  }
}
