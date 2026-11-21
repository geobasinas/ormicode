import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsForDesignProject } from '../src/features/design/design-sessions.ts';

test('linked design sessions share the canvas root: project worktrees or the same scratch folder', () => {
  const sessions = [
    { id: 'main', project: '/repo', cwd: '/repo' },
    { id: 'worktree', project: '/repo', cwd: '/repo/.ormi/worktrees/task' },
    { id: 'other', project: '/scratch-repo', cwd: '/scratch-repo' },
    { id: 'scratch', project: 'scratch', cwd: '/tmp/scratch' },
    { id: 'scratch2', project: 'scratch', cwd: '/tmp/scratch' },
    { id: 'scratch3', project: 'scratch', cwd: '/tmp/scratch-other' },
  ];
  assert.deepEqual(sessionsForDesignProject(sessions, '/repo').map(item => item.id), ['main', 'worktree']);
  assert.deepEqual(sessionsForDesignProject(sessions, '/scratch-repo').map(item => item.id), ['other']);
  assert.deepEqual(sessionsForDesignProject(sessions, 'scratch', '/tmp/scratch').map(item => item.id), ['scratch', 'scratch2']);
  assert.deepEqual(sessionsForDesignProject(sessions, 'scratch'), []);
  assert.deepEqual(sessionsForDesignProject(sessions, ''), []);
});
