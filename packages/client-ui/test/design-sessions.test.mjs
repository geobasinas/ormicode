import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsForDesignProject } from '../src/features/design/design-sessions.ts';

test('linked design sessions stay on the current project, including its worktrees', () => {
  const sessions = [
    { id: 'main', project: '/repo', cwd: '/repo' },
    { id: 'worktree', project: '/repo', cwd: '/repo/.ormi/worktrees/task' },
    { id: 'other', project: '/scratch-repo', cwd: '/scratch-repo' },
    { id: 'scratch', project: 'scratch', cwd: '/tmp/scratch' },
  ];
  assert.deepEqual(sessionsForDesignProject(sessions, '/repo').map(item => item.id), ['main', 'worktree']);
  assert.deepEqual(sessionsForDesignProject(sessions, '/scratch-repo').map(item => item.id), ['other']);
  assert.deepEqual(sessionsForDesignProject(sessions, 'scratch'), []);
  assert.deepEqual(sessionsForDesignProject(sessions, ''), []);
});
