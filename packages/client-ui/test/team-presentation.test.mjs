import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalInput, approvalPreview, branchLabel, isTeamRunning, teamState, visibleTeamChips } from '../src/features/session/team-presentation.ts';
import { needsAttention, attentionReason } from '../src/features/session/attention.ts';

const session = (state = 'running', extra = {}) => ({ id: 'child', project: 'demo', state, ...extra });
const entry = (rank, wants = null) => ({ session: 'child', rank, wants });

test('compact approval previews use the first nonempty command line with safe fallbacks', () => {
  assert.equal(approvalPreview({ command: 'echo inspect release checks\n\nnext step' }, 'Bash'), 'echo inspect release checks');
  assert.equal(approvalPreview('\r\n  echo check\r\nnext', 'Bash'), 'echo check');
  assert.equal(approvalPreview(undefined, 'Read'), 'Read');
  assert.equal(approvalPreview('', 'Read'), 'Read');
  assert.equal(approvalPreview({ path: 'README.md' }, 'Read'), 'Read');
  assert.equal(approvalPreview(null, 'Read'), 'Read');
});

test('roster overflow reserves room for +N and adapts from empty to narrow and wide rows', () => {
  assert.equal(visibleTeamChips(400, []), 0);
  assert.equal(visibleTeamChips(0, [100]), 0);
  assert.equal(visibleTeamChips(99, [100]), 0);
  assert.equal(visibleTeamChips(100, [100]), 1);
  assert.equal(visibleTeamChips(137, [100, 100]), 0);
  assert.equal(visibleTeamChips(138, [100, 100]), 1);
  assert.equal(visibleTeamChips(206, [100, 100]), 2);
  assert.equal(visibleTeamChips(244, [100, 100, 100]), 2);
  assert.equal(visibleTeamChips(1000, [100, 100, 100]), 3);
});

test('team states distinguish independent work, parent waits, parent loss, failures and completion', () => {
  const states = [session(), session('awaiting_approval', { delegatedApproval: true }), session('running', { parentless: true }), session('failed'), session('done')].map(teamState);
  assert.deepEqual(states.map(s => s.label), ['Running', 'Needs parent', 'Parentless', 'Failed', 'Done']);
  assert.equal(new Set(states.map(s => s.tone)).size, 5);
  assert.match(states[2].help, /keeps running independently/);
  assert.equal(teamState(session('awaiting_input')).label, 'Needs you');
  assert.equal(teamState(session('unknown')).label, 'Idle');
});

test('running counts include independent parentless work but not delegated waits or inactive children', () => {
  for (const state of ['running', 'starting', 'retrying']) assert.equal(isTeamRunning(session(state)), true);
  assert.equal(isTeamRunning(session('running', { parentless: true })), true);
  assert.equal(isTeamRunning(session('running', { delegatedApproval: true })), false);
  for (const state of ['idle', 'done', 'failed', 'awaiting_input', 'unknown']) assert.equal(isTeamRunning(session(state)), false);
});

test('generated worktree identifiers get a friendly label without renaming ordinary branches', () => {
  const branch = 'ormi-01M7TWKTAV2SPT27XS7QAT8NMJ';
  assert.equal(branchLabel({ branch, worktree: true }), 'worktree');
  assert.equal(branchLabel({ branch, worktree: false }), branch);
  for (const name of ['main', 'feature/release-notes', 'ormi/fix-ui']) assert.equal(branchLabel({ branch: name, worktree: true }), name);
  assert.equal(branchLabel({}), ''); assert.equal(branchLabel({ branch: null }), '');
});

test('approval commands preserve real newlines, shell escapes and punctuation instead of JSON quoting', () => {
  const command = 'echo checks\n\nprintf "\\n"';
  assert.equal(approvalInput({ command }), command);
  assert.equal(approvalInput('echo safe'), 'echo safe');
  assert.equal(approvalInput({ path: 'notes.md' }), '{\n  "path": "notes.md"\n}');
  assert.equal(approvalInput(undefined), ''); assert.equal(approvalInput(null), 'null');
});

test('Needs You excludes ordinary running/progressed/done and delegated approvals, even in digest fallback', () => {
  assert.equal(needsAttention(session()), false);
  for (const rank of ['silent', 'progressed', 'done']) assert.equal(needsAttention(session(), entry(rank)), false);
  assert.equal(needsAttention(session('awaiting_approval', { delegatedApproval: true }), entry('waiting')), false);
  assert.equal(needsAttention(session('archived'), entry('waiting', { kind: 'question' })), false);
});

test('user-routed approvals and questions override a simultaneous delegated wait', () => {
  const mixed = session('awaiting_approval', { delegatedApproval: true });
  for (const kind of ['approval', 'question']) assert.equal(needsAttention(mixed, entry('waiting', { kind })), true);
  assert.equal(needsAttention(mixed), false);
  assert.equal(needsAttention(mixed, entry('waiting', { kind: 'rate_limit' })), false);
  assert.equal(needsAttention({ ...mixed, state: 'archived' }, entry('waiting', { kind: 'approval' })), false);
});

test('genuine questions remain actionable while workers run, including late-answer questions and offline fallback', () => {
  const question = entry('waiting', { kind: 'question', since: 100 });
  assert.equal(needsAttention(session(), question), true);
  assert.equal(attentionReason(session(), question), 'Question for you');
  for (const [state, label] of [['awaiting_input', 'Question for you'], ['awaiting_approval', 'Approval needed']]) {
    assert.equal(needsAttention(session(state)), true); assert.equal(attentionReason(session(state)), label);
  }
  assert.equal(needsAttention(session(), entry('failed')), false);
});

test('stopped, failed, idle and rate-limited sessions never enter Needs You through stale digest entries', () => {
  for (const state of ['interrupted', 'failed', 'idle', 'paused_rate_limited', 'done', 'archived']) {
    for (const digest of [undefined, entry('failed'), entry('waiting'), entry('waiting', { kind: 'approval' }), entry('waiting', { kind: 'question' })])
      assert.equal(needsAttention(session(state), digest), false, `${state}: ${JSON.stringify(digest)}`);
  }
  assert.equal(attentionReason(session('interrupted')), 'Session stopped');
  assert.equal(attentionReason(session('failed')), 'Session failed');
  assert.equal(teamState(session('interrupted')).label, 'Stopped');
  assert.equal(teamState(session('interrupted')).icon, 'idle');
  assert.equal(teamState(session('paused_rate_limited')).label, 'Rate limited');
  assert.equal(teamState(session('failed')).icon, 'failed');
  assert.equal(needsAttention(session(), entry('waiting', { kind: 'rate_limit' })), false);
});
