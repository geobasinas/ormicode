import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace, removeWorktree } from '@ormicode/git-core';
import { sessionEnvironment } from '../src/session-env.ts';
import { runSessionHook } from '../src/workspace-hooks.ts';

test('setup receives the full session environment while preserving workspace paths', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ormi-hook-setup-'));
  let worktree;
  let branch;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Ormi Tests'], { cwd: project });
    execFileSync('git', ['config', 'user.email', 'tests@example.invalid'], { cwd: project });
    mkdirSync(join(project, '.ormi'), { recursive: true });
    writeFileSync(join(project, '.ormi', 'setup'), [
      'printf "%s\\n" "$PORT" "$ORMI_SESSION" "$ORMI_WORKTREE" "$ORMI_PROJECT_ROOT" "$ORMI_BRANCH" "$ORMI_ROOT_PATH" "$ORMI_WORKTREE_PATH" > "$ORMI_WORKTREE_PATH/setup-env.txt"',
    ].join('\n'));
    writeFileSync(join(project, 'file.txt'), 'tracked');
    execFileSync('git', ['add', '.'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: project, stdio: 'ignore' });
    const env = sessionEnvironment({ session: 's_setup', project, cwd: project, base: 43000 });
    const resolved = await resolveWorkspace(project, { kind: 'worktree', branch: 'main', name: 'setup-env', skipInclude: true }, 'setup-env', 's_setup', () => false, env);
    assert.ok(!('err' in resolved), resolved.detail);
    worktree = resolved.worktree;
    branch = resolved.branch;
    const values = readFileSync(join(worktree, 'setup-env.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(values, [
      '43000', 's_setup', worktree, project, resolved.branch, project, worktree,
    ]);
  } finally {
    if (worktree && branch) removeWorktree(project, worktree, branch);
    rmSync(project, { recursive: true, force: true });
  }
});

test('resume hooks are journaled, use project-root fallback, and missing resume is silent', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ormi-hook-resume-'));
  const cwd = join(project, 'worktree');
  mkdirSync(cwd);
  mkdirSync(join(project, '.ormi'));
  const events = [];
  const row = { id: 's_resume', project, cwd, worktree: cwd, branch: 'feature' };
  try {
    writeFileSync(join(project, '.ormi', 'resume'), 'printf "resume:%s:%s\\n" "$ORMI_SESSION" "$PORT"');
    await runSessionHook(row, 'resume', 43010, (...event) => events.push(event));
    assert.equal(events[0][2].step, 'resume');
    assert.equal(events[0][2].status, 'ok');
    assert.match(events[0][2].output, /resume:s_resume:43010/);
    rmSync(join(project, '.ormi', 'resume'));
    events.length = 0;
    await runSessionHook(row, 'resume', 43010, (...event) => events.push(event));
    assert.deepEqual(events, []);
  } finally { rmSync(project, { recursive: true, force: true }); }
});
