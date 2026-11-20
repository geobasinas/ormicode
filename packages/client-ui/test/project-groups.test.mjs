import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects, groupSessionProjects } from '../src/features/projects/groupProjects.ts';

const session = (id, project, updatedAt, state = 'idle') => ({
  id, project, updatedAt, state, title: id, vendor: 'fake',
});
const project = (path, name, addedAt) => ({ machine: 'm_local', path, name, addedAt, git: false });

test('project groups retain team hierarchy, child search and empty registered projects', () => {
  const sessions = [
    { ...session('parent', '/repo', 1), team: 'team', tokens: 2 },
    { ...session('child', '/repo', 2), team: 'team', parent: 'parent', tokens: 3 },
    { ...session('other', '/repo', 3), team: 'team', parent: 'parent', tokens: 5 },
  ];
  const projects = [project('/repo', 'Named Project', 1), project('/empty', 'Empty', 2)];
  const groups = groupSessionProjects(sessions, projects);
  assert.equal(groups[0].nodes.length, 1);
  assert.equal(groups[0].nodes[0].tokens, 10);
  assert.equal(groups[0].nodes[0].children.length, 2);
  assert.deepEqual(groups[1].nodes, []);
  const searched = groupSessionProjects(sessions, projects, 'child')[0];
  assert.equal(searched.nodes[0].session.id, 'parent');
  assert.deepEqual(searched.nodes[0].children.map(node => node.session.id), ['child']);
  assert.equal(groupSessionProjects(sessions, projects, 'named')[0].nodes[0].children.length, 2);
  assert.deepEqual(groupSessionProjects(sessions, projects, 'missing'), []);
  assert.deepEqual(groupSessionProjects([], []), []);
});

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
