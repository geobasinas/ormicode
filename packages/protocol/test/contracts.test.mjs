import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestBody, parseResponseBody, parseEventBody } from '../src/index.ts';

const session = 's_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const machine = 'm_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const request = 'req_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const start = { machine, project: '/repo', vendor: 'fake', transport: 'cli', model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'current' } };

test('session start validates the workspace choice and preserves agent values', () => {
  assert.deepEqual(parseRequestBody('session.start', start), { success: true, data: start });
  assert.deepEqual(parseRequestBody('session.start', { ...start, machine: 'm_local' }), { success: true, data: { ...start, machine: 'm_local' } });
  for (const machine of ['', 'm_other', 'm_local/../remote', null, undefined])
    assert.equal(parseRequestBody('session.start', { ...start, machine }).success, false);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'worktree', branch: 'main' } }).success, true);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'checkout', branch: 'origin/feature' } }).success, true);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'branch', branch: 'ormi/new', from: 'feature' } }).success, true);
  assert.equal(parseRequestBody('session.start', {
    ...start, workspace: {
      kind: 'worktree', branch: 'origin/main', name: 'ormi/new-task', includeDirty: true, skipInclude: true, skipSetup: true,
    },
  }).success, true);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'existing', path: '/repo/.ormi/worktrees/task' } }).success, true);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'worktree' } }).success, false);
  assert.equal(parseRequestBody('session.start', { ...start, machine: 'unknown' }).success, false);
});

test('project branch and fetch contracts include default and worktree metadata', () => {
  assert.equal(parseRequestBody('project.fetch', { project: '/repo' }).success, true);
  assert.equal(parseRequestBody('project.pull', { project: '/repo', branch: 'main' }).success, true);
  assert.equal(parseRequestBody('project.renameBranch', { project: '/repo', from: 'old', to: 'new' }).success, true);
  assert.equal(parseRequestBody('project.deleteBranch', { project: '/repo', name: 'feature', confirm: 'feature', force: true }).success, true);
  assert.equal(parseRequestBody('project.fetch', { project: '' }).success, false);
  assert.equal(parseResponseBody('project.fetch', { ok: true }).success, true);
  assert.equal(parseResponseBody('project.fetch', { ok: false, error: 'offline' }).success, true);
  assert.equal(parseResponseBody('project.pull', { updated: true, from: 'abc123', to: 'def456' }).success, true);
  assert.equal(parseResponseBody('project.renameBranch', {}).success, true);
  assert.equal(parseResponseBody('project.deleteBranch', {}).success, true);
  const branch = { name: 'main', sha: 'abc123', subject: 'initial', ts: 1, upstream: null, ahead: 0, behind: 0, current: true, gone: false, merged: true, worktreePath: null };
  const body = {
    isRepo: true, current: 'main', local: [branch], remote: [], detached: false, dirty: 1, busyBranches: ['main'],
    defaultBranch: 'origin/main', hasWorktreeInclude: true, hasSetup: true, fetchedAt: 1000,
    worktrees: [{ path: '/repo/.ormi/worktrees/task', branch: 'ormi/task', session, state: 'idle', dirty: 2 }],
  };
  assert.equal(parseResponseBody('project.branches', body).success, true);
  assert.equal(parseResponseBody('project.branches', {
    ...body, worktrees: [{ path: '/repo/wt', branch: null, session: null, state: null, dirty: 0 }],
  }).success, true);
});

test('response contracts reject missing fields and unknown methods', () => {
  assert.equal(parseResponseBody('session.start', { session }).success, true);
  assert.equal(parseResponseBody('session.start', {}).success, false);
  assert.equal(parseResponseBody('session.prompt', { accepted: false }).success, false);
  assert.equal(parseResponseBody('session.list', { sessions: [] }).success, true);
  assert.deepEqual(parseResponseBody('session.teleport', {}), { success: false, error: 'protocol.unknown_method' });
});

test('machine, browse, and project registry methods validate request and response bodies', () => {
  const machineBody = { id: 'm_local', name: 'workstation', kind: 'local', status: 'online', heartbeat: 100 };
  const project = { machine: 'm_local', path: '/repo', name: 'repo', git: true, addedAt: 100 };
  const cases = [
    ['machine.list', {}, null, { machines: [machineBody] }, { machines: [{ ...machineBody, kind: 'unknown' }] }],
    ['fs.browse', { machine: 'm_local', path: '/home', hidden: true }, { machine: 'm_local', hidden: 'yes' },
      { machine: 'm_local', path: '/home', parent: '/', home: '/home', entries: [], truncated: false },
      { machine: 'm_local', path: '/home', parent: '/', home: '/home', entries: [{ name: 'x', path: '/home/x', git: 'yes', hidden: false }], truncated: false }],
    ['project.list', {}, null, { projects: [project] }, { projects: [{ ...project, addedAt: -1 }] }],
    ['project.add', { machine: 'm_local', path: '/repo' }, { machine: 'm_local', path: '' }, { project }, { project: { ...project, name: '' } }],
    ['project.remove', { machine: 'm_local', path: '/repo' }, { machine: '', path: '/repo' }, { removed: true }, { removed: 'yes' }],
  ];
  for (const [method, validRequest, invalidRequest, validResponse, invalidResponse] of cases) {
    assert.equal(parseRequestBody(method, validRequest).success, true, `${method} valid request`);
    assert.equal(parseRequestBody(method, invalidRequest).success, false, `${method} invalid request`);
    assert.equal(parseResponseBody(method, validResponse).success, true, `${method} valid response`);
    assert.equal(parseResponseBody(method, invalidResponse).success, false, `${method} invalid response`);
  }
});

test('preview relay requests and paged responses are bounded and typed', () => {
  const request = { session, port: 41001, method: 'POST', path: '/submit', headers: { 'content-type': 'text/plain' }, body: 'aGVsbG8=' };
  assert.equal(parseRequestBody('preview.fetch', request).success, true);
  assert.equal(parseRequestBody('preview.fetch', { ...request, port: 40000 }).success, true);
  assert.equal(parseRequestBody('preview.fetchMore', { handle: 'opaque-handle' }).success, true);
  assert.equal(parseResponseBody('preview.fetch', { status: 200, headers: {}, body: 'AA==', size: 1, more: 'opaque-handle' }).success, true);
  assert.equal(parseResponseBody('preview.fetchMore', { body: 'AA==' }).success, true);
});

test('conversation rewind events and checkpoint restore responses have explicit shapes', () => {
  assert.equal(parseEventBody({ kind: 'conversation_rewound', to: 12, checkpoint: 'abc123' }).success, true);
  assert.equal(parseResponseBody('checkpoint.restore', { restored: true, id: 'abc123', mode: 'conversation' }).success, true);
});

test('handoff estimate and brief contracts validate inputs and results', () => {
  assert.equal(parseRequestBody('session.handoffBrief', { session }).success, true);
  assert.equal(parseRequestBody('session.handoffEstimate', { session, to: { model: 'sonnet' }, mode: 'rehydrate' }).success, true);
  assert.equal(parseRequestBody('session.handoffEstimate', { session, to: {}, mode: 'invalid' }).success, false);
  assert.equal(parseResponseBody('session.handoffBrief', { brief: 'context' }).success, true);
  assert.equal(parseResponseBody('session.handoffEstimate', {
    briefTokens: 12, contextTokens: 20, filesChanged: 2, usd: null, confirmUsd: 1, confirmRequired: true,
  }).success, true);
});

test('scratch copy-out contracts validate project paths and overwrite intent', () => {
  const request = { session, paths: ['notes/brief.md'], project: '/repo', dest: 'docs' };
  assert.equal(parseRequestBody('session.copyOut', request).success, true);
  assert.equal(parseRequestBody('session.copyOut', { ...request, paths: [] }).success, false);
  assert.equal(parseRequestBody('session.copyOut', { ...request, overwrite: 'yes' }).success, false);
  assert.equal(parseResponseBody('session.copyOut', { copied: [{ from: 'notes/brief.md', to: 'docs/notes/brief.md' }] }).success, true);
  assert.equal(parseResponseBody('session.copyOut', { copied: [{ from: '../secret', to: '/tmp/secret' }] }).success, true);
  const details = {
    id: session, title: null, state: 'idle', project: 'scratch', cwd: '/scratch/session', vendor: 'fake',
    transport: 'cli', updatedAt: 1, model: null, effort: null, scratchFiles: 2,
  };
  assert.equal(parseResponseBody('session.get', details).success, true);
});

test('cost totals contracts validate time filters and all aggregation buckets', () => {
  assert.equal(parseRequestBody('cost.totals', {}).success, true);
  assert.equal(parseRequestBody('cost.totals', { since: 0 }).success, true);
  assert.equal(parseRequestBody('cost.totals', { since: -1 }).success, false);
  const bucket = { tokens: 12, usd: null, unpriced: 1, estimate: false };
  const body = {
    total: bucket, projects: [{ project: '/repo', ...bucket }],
    days: [{ date: '2025-01-02', ...bucket }], sessions: [{ session, project: '/repo', ...bucket }],
  };
  assert.equal(parseResponseBody('cost.totals', body).success, true);
  assert.equal(parseResponseBody('cost.totals', { ...body, days: [{ date: 'yesterday', ...bucket }] }).success, false);
});

test('models.list contracts include transport, model availability and per-adapter errors', () => {
  assert.equal(parseRequestBody('models.list', {}).success, true);
  assert.equal(parseRequestBody('models.list', { agent: 'pi', transport: 'sdk', refresh: true }).success, true);
  assert.equal(parseRequestBody('models.list', { agent: '' }).success, false);
  const entry = {
    agent: 'claude', transport: 'sdk', id: 'claude-sonnet-4-6', label: 'Sonnet 4.6',
    efforts: ['low', 'high'], available: true, cachedAt: 1,
  };
  assert.equal(parseResponseBody('models.list', { models: [entry] }).success, true);
  assert.equal(parseResponseBody('models.list', { models: [entry], errors: [{ agent: 'pi', transport: 'cli', message: 'not found' }] }).success, true);
  assert.equal(parseResponseBody('models.list', { models: [{ ...entry, efforts: 'high' }] }).success, false);
});

test('project.branches contracts include repository status and busy branches', () => {
  const branch = { name: 'main', sha: 'abc123', subject: 'initial', ts: 1, upstream: null, ahead: 0, behind: 0, current: true, gone: false, merged: true, worktreePath: null };
  const response = {
    isRepo: true, detached: false, dirty: 2, busyBranches: ['main'], defaultBranch: 'origin/main',
    hasWorktreeInclude: false, hasSetup: false, fetchedAt: null,
    worktrees: [{ path: '/repo/.ormi/worktrees/task', branch: 'ormi/task', session: null, state: null, dirty: 0 }],
    current: 'main', local: [branch], remote: [],
  };
  assert.equal(parseRequestBody('project.branches', { project: '/repo' }).success, true);
  assert.equal(parseResponseBody('project.branches', response).success, true);
  assert.equal(parseResponseBody('project.branches', { ...response, dirty: -1 }).success, false);
  assert.equal(parseResponseBody('project.branches', { ...response, detached: 'false' }).success, false);
  assert.equal(parseResponseBody('project.branches', {
    isRepo: false, detached: false, dirty: 0, busyBranches: [], defaultBranch: null, worktrees: [],
    hasWorktreeInclude: false, hasSetup: false, fetchedAt: null,
    current: null, local: [], remote: [],
  }).success, true);
});

test('secret listing exposes only names and scope metadata', () => {
  assert.equal(parseRequestBody('secret.list', {}).success, true);
  assert.equal(parseRequestBody('secret.list', { project: '/repo' }).success, true);
  assert.equal(parseResponseBody('secret.list', {
    keyring: 'memory', available: true,
    secrets: [{ name: 'API_KEY', scope: 'project', declared: true, missing: false }],
  }).success, true);
  assert.equal(parseResponseBody('secret.list', {
    keyring: 'memory', available: true,
    secrets: [{ name: 'api-key', scope: 'project', declared: true, missing: false }],
  }).success, false);
});

test('event body contracts check state, text and approval data', () => {
  assert.equal(parseEventBody({ kind: 'text', text: 'hello' }).success, true);
  assert.equal(parseEventBody({ kind: 'text' }).success, false);
  assert.equal(parseEventBody({ kind: 'state', state: 'running' }).success, true);
  assert.equal(parseEventBody({ kind: 'state', state: 'invented' }).success, false);
  assert.equal(parseEventBody({ kind: 'approval_request', request, options: [{ id: 'allow', label: 'Allow' }] }).success, true);
  assert.equal(parseEventBody({ kind: 'approval_decision', request, option: '' }).success, false);
  assert.deepEqual(parseEventBody({ kind: 'unknown' }), { success: false, error: 'protocol.unknown_event' });
  assert.deepEqual(parseEventBody(null), { success: false, error: 'protocol.invalid_frame' });
});

test('agent events require matching tool, usage and retry data', () => {
  const call = { kind: 'tool_call', callId: 'call-1', name: 'read', input: { path: 'a' }, raw: { vendor: true } };
  assert.deepEqual(parseEventBody(call), { success: true, data: call });
  assert.equal(parseEventBody({ kind: 'tool_call', callId: 'call-1', name: 'read' }).success, false);
  assert.equal(parseEventBody({ kind: 'tool_result', callId: 'call-1', status: 'interrupted' }).success, true);
  assert.equal(parseEventBody({ kind: 'usage', input: -1 }).success, false);
  assert.deepEqual(parseEventBody({ kind: 'usage', model: 'gpt-5.5', input: 1, costCumulativeUsd: 0.5, extra: true }).data, { kind: 'usage', model: 'gpt-5.5', input: 1, costCumulativeUsd: 0.5, extra: true });
  assert.equal(parseEventBody({ kind: 'usage', costCumulativeUsd: -1 }).success, false);
  assert.equal(parseEventBody({ kind: 'usage', model: 5 }).success, false);
  assert.equal(parseEventBody({ kind: 'retry_scheduled', delayMs: -1 }).success, false);
  assert.equal(parseEventBody({ kind: 'workspace_step', step: 'setup', status: 'warn', output: 'warning' }).success, true);
  assert.equal(parseEventBody({ kind: 'workspace_step', step: 'resume', status: 'ok' }).success, true);
  assert.equal(parseEventBody({ kind: 'workspace_step', step: 'teardown', status: 'skipped' }).success, true);
  assert.equal(parseEventBody({ kind: 'service_state', service: 'web', state: 'running', port: 41000 }).success, true);
  assert.equal(parseEventBody({ kind: 'workspace_step', step: 'unknown', status: 'ok' }).success, false);
  assert.equal(parseEventBody({ kind: 'text', text: 'ok', raw: undefined }).success, false);
});

test('service and preview methods validate their request and response contracts', () => {
  const session = 's_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
  const entry = { name: 'web', state: 'running', port: 41000, portals: [{ title: 'Home', path: '/', url: 'http://web.localhost:123/__ormi/auth?t=x' }] };
  assert.equal(parseRequestBody('service.list', { session }).success, true);
  assert.equal(parseRequestBody('service.start', { session, service: 'web' }).success, true);
  assert.equal(parseRequestBody('service.logs', { session, service: 'web', after: 4 }).success, true);
  assert.equal(parseRequestBody('preview.url', { session, port: 41000, path: '/admin' }).success, true);
  assert.equal(parseRequestBody('preview.console', { session, after: 10, limit: 20 }).success, true);
  assert.equal(parseRequestBody('preview.consoleClear', { session }).success, true);
  assert.equal(parseResponseBody('service.list', { ports: { base: 41000, count: 10 }, proxy: { port: 123 }, config: { found: true }, services: [entry], detected: [] }).success, true);
  assert.equal(parseResponseBody('service.logs', { lines: [{ text: 'line', stream: 'stderr' }], next: 1, truncated: false }).success, true);
  assert.equal(parseResponseBody('preview.url', { url: 'http://web.localhost:123/__ormi/auth?t=x' }).success, true);
  const consoleEntry = { id: 'pc_1', seq: 1, ts: 10, port: 41000, path: '/', kind: 'network', level: 'error', message: 'HTTP 500', method: 'GET', url: '/broken', status: 500 };
  assert.equal(parseResponseBody('preview.console', { entries: [consoleEntry], next: 1, dropped: 0 }).success, true);
  assert.equal(parseResponseBody('preview.consoleClear', { cleared: true }).success, true);
});

test('prompt contexts accept bounded element and console references', () => {
  const element = {
    kind: 'element', element: {
      url: 'http://web.localhost/page', selector: '#card', html: '<div id="card"></div>', text: 'Card',
      styles: { display: 'block' }, rect: { x: 1, y: 2, width: 30, height: 40, devicePixelRatio: 2 },
      component: 'Card', source: 'src/Card.tsx:1:1', comment: 'Change this', index: 1,
    },
  };
  assert.equal(parseRequestBody('session.prompt', { session, text: 'inspect', context: [element, { kind: 'console', console: { ids: [] } }] }).success, true);
  assert.equal(parseRequestBody('session.prompt', {
    session, text: 'inspect', context: [{ ...element, element: { ...element.element, html: 'x'.repeat(4097) } }],
  }).success, false);
  assert.equal(parseRequestBody('session.prompt', {
    session, text: 'inspect', context: [{ ...element, element: { ...element.element, styles: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`style-${index}`, 'x'])) } }],
  }).success, false);
});

test('session controls and notes use matching request and response contracts', () => {
  const note = 'n_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
  assert.equal(parseRequestBody('session.setModel', { session, model: 'model-a' }).success, true);
  assert.equal(parseRequestBody('session.setModel', { session, model: '' }).success, false);
  assert.equal(parseRequestBody('session.setOption', { session, id: 'test', value: true }).success, true);
  assert.equal(parseRequestBody('session.setNotes', { session, id: note, title: 'note', body: 'content' }).success, true);
  assert.equal(parseResponseBody('session.setNotes', { id: note }).success, true);
  assert.equal(parseResponseBody('session.steer', { accepted: true, queued: true }).success, true);
  assert.equal(parseResponseBody('session.steer', { accepted: true }).success, false);
});

test('session queue methods and queue change events preserve item summaries', () => {
  const item = { id: 'q_01J8Z3K4M5N6P7WXYZ12345678', text: 'follow up', createdAt: 1, images: 2 };
  const context = [{ kind: 'file', path: 'src/main.ts' }];
  const attachments = [{ name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }];
  assert.equal(parseRequestBody('session.queue.add', { session, text: 'follow up', context, attachments, images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }] }).success, true);
  assert.equal(parseRequestBody('session.prompt', { session, text: 'with context', context, attachments }).success, true);
  assert.equal(parseRequestBody('session.start', {
    machine: 'm_01J8Z3K4M5N6P7Q8R9S0T1V2W3', project: '/repo', vendor: 'fake', transport: 'cli',
    model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'current' }, context, attachments,
  }).success, true);
  assert.equal(parseRequestBody('session.queue.list', { session }).success, true);
  assert.equal(parseRequestBody('session.queue.update', { session, id: item.id, text: 'updated' }).success, true);
  assert.equal(parseRequestBody('session.queue.remove', { session, id: item.id }).success, true);
  assert.equal(parseRequestBody('session.queue.move', { session, id: item.id, index: 0 }).success, true);
  assert.equal(parseResponseBody('session.queue.add', { id: item.id }).success, true);
  assert.equal(parseResponseBody('session.queue.list', { items: [item] }).success, true);
  assert.equal(parseResponseBody('session.queue.update', { updated: true }).success, true);
  assert.equal(parseResponseBody('session.queue.remove', { removed: true }).success, true);
  assert.equal(parseResponseBody('session.queue.move', { moved: true }).success, true);
  assert.equal(parseEventBody({ kind: 'queue_changed', items: [item] }).success, true);
  const failed = { ...item, error: 'Referenced file no longer exists' };
  assert.equal(parseResponseBody('session.queue.list', { items: [failed] }).success, true);
  assert.equal(parseEventBody({ kind: 'queue_changed', items: [failed] }).success, true);
});

test('project.searchFiles returns file and folder matches', () => {
  assert.equal(parseRequestBody('project.searchFiles', { project: '/repo', query: '', limit: 100 }).success, true);
  assert.equal(parseResponseBody('project.searchFiles', {
    files: [{ path: 'src', kind: 'folder', score: 1, positions: [0] }], truncated: false,
  }).success, true);
});

test('draft and prompt history contracts support the home composer', () => {
  assert.equal(parseRequestBody('session.draft.get', { session: 'home' }).success, true);
  assert.equal(parseRequestBody('session.draft.set', { session, text: 'draft text' }).success, true);
  assert.equal(parseResponseBody('session.draft.get', { text: '' }).success, true);
  assert.equal(parseResponseBody('session.draft.set', { saved: true }).success, true);
  assert.equal(parseRequestBody('session.commands', { session }).success, true);
  assert.equal(parseResponseBody('session.commands', { commands: [{ name: 'review', description: 'Review changes', source: 'agent' }] }).success, true);
  assert.equal(parseRequestBody('prompts.history', { project: '/repo', query: 'fix', limit: 20 }).success, true);
  assert.equal(parseResponseBody('prompts.history', {
    items: [{ text: 'fix it', createdAt: Date.now(), session, project: '/repo' }],
  }).success, true);
});

test('file methods validate their requests, responses and edit journal event', () => {
  for (const method of ['file.list', 'file.read', 'file.write', 'file.search', 'file.blame', 'file.history']) {
    const body = method === 'file.list' ? { session }
      : method === 'file.read' ? { session, path: 'src/main.ts', ref: 'HEAD' }
      : method === 'file.write' ? { session, path: 'src/main.ts', content: 'updated', baseMtime: 0 }
      : method === 'file.search' ? { session, query: 'main', mode: 'name' }
      : method === 'file.blame' ? { session, path: 'src/main.ts' }
      : { session, path: 'src/main.ts', limit: 10 };
    assert.equal(parseRequestBody(method, body).success, true, method);
  }
  assert.equal(parseRequestBody('file.search', { session, query: '', mode: 'name' }).success, false);
  assert.equal(parseRequestBody('file.search', { session, query: 'x', mode: 'content', limit: 1001 }).success, false);

  assert.equal(parseResponseBody('file.list', {
    root: '/repo', path: '', entries: [{ name: 'src', path: 'src', kind: 'dir', size: 0, mtime: 1, git: 'modified' }], free: null,
  }).success, true);
  assert.equal(parseResponseBody('file.read', {
    path: 'src/main.ts', size: 7, mtime: null, binary: false, mime: 'text/plain', encoding: 'utf8', content: 'updated', tooLarge: false,
  }).success, true);
  assert.equal(parseResponseBody('file.write', { path: 'src/main.ts', size: 7, mtime: 1, checkpoint: null }).success, true);
  assert.equal(parseResponseBody('file.search', {
    matches: [{ path: 'src/main.ts', line: 1, text: 'é value', ranges: [[2, 7]] }], truncated: false,
  }).success, true);
  assert.equal(parseResponseBody('file.blame', {
    hunks: [{ start: 1, count: 1, sha: '0'.repeat(40) }],
    commits: { ['0'.repeat(40)]: { author: 'Not committed yet', ts: 0, summary: '' } },
  }).success, true);
  const history = { commits: [], total: 0 };
  assert.equal(parseResponseBody('file.history', history).success, true);
  assert.equal(parseEventBody({ kind: 'file_edit', path: 'src/main.ts', size: 7, checkpoint: null }).success, true);
});

test('wire parser checks byte length, JSON and protocol version', async () => {
  const { parseWireFrame, MAX_FRAME_BYTES } = await import('../src/index.ts');
  assert.equal(parseWireFrame(JSON.stringify({ v: 1, type: 'ack', session, seq: 2 })).success, true);
  assert.deepEqual(parseWireFrame('{broken'), { success: false, error: 'protocol.invalid_frame' });
  assert.deepEqual(parseWireFrame('{"v":2}'), { success: false, error: 'protocol.unsupported_version' });
  assert.deepEqual(parseWireFrame('é'.repeat(MAX_FRAME_BYTES / 2 + 1)), { success: false, error: 'protocol.invalid_frame' });
});

test('question contracts preserve vendor presentation fields', () => {
  const body = { kind: 'question_request', request, questions: [{ question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First', preview: 'example' }], multiSelect: false }] };
  assert.deepEqual(parseEventBody(body), { success: true, data: body });
  assert.equal(parseRequestBody('session.answer', { session, request, answers: { 'Which?': 'A' } }).success, true);
  assert.equal(parseRequestBody('session.answer', { session, request, answers: { 'Which?': '' } }).success, false);
  assert.equal(parseResponseBody('session.answer', { answered: true }).success, true);
});
