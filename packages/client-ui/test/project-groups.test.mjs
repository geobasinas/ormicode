import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects } from '../src/features/projects/groupProjects.ts';

const session = (id, project, updatedAt, state = 'idle') => ({
  id, project, updatedAt, state, title: id, vendor: 'fake',
});
const project = (path, name, addedAt) => ({ machine: 'm_local', path, name, addedAt, git: false });

test('project groups sort populated by recency, empty by added time, and scratch last', () => {
  const groups = groupProjects([
    session('old', '/repo/old', 10),
    session('new', '/repo/new', 30),
    session('scratch', 'scratch', 100),
  ], [
    project('/repo/empty-old', 'empty old', 10),
    project('/repo/old', 'old', 1),
    project('/repo/empty-new', 'empty new', 20),
    project('/repo/new', 'new', 2),
  ]);
  assert.deepEqual(groups.map(group => group.project), [
    '/repo/new', '/repo/old', '/repo/empty-new', '/repo/empty-old', 'scratch',
  ]);
  assert.deepEqual(groups[2].sessions, []);
  assert.equal(groups[2].name, 'empty new');
});

test('query matches registered project names for empty groups', () => {
  const projects = [project('/repo/alpha', 'Alpha Project', 20), project('/repo/beta', 'Beta', 10)];
  assert.deepEqual(groupProjects([], projects, 'alpha').map(group => group.project), ['/repo/alpha']);
  assert.deepEqual(groupProjects([session('beta-session', '/repo/beta', 1)], projects, 'alpha')
    .map(group => group.project), ['/repo/alpha']);
});
