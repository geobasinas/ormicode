import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUiFileChanges, isUiFileChange, recordUiCheckResult, shouldResetUiCheckFollowups, shouldRunUiCheck, uiCheckFollowupText, UiCheckFollowupGuard } from '../src/ui-check.ts';

test('UI file matcher recognizes supported frontend extensions', () => {
  for (const path of ['src/App.tsx', 'a.jsx', 'View.vue', 'Widget.svelte', 'page.astro', 'index.html', 'site.css', 'theme.scss', 'legacy.sass', 'style.less', 'body.mdx']) {
    assert.equal(isUiFileChange(path), true, path);
  }
  for (const path of ['src/app.TSX', 'nested\\page.HTML']) assert.equal(isUiFileChange(path), true, path);
  for (const path of ['package.json', 'src/app.ts', 'README.md', 'styles.css.map']) assert.equal(isUiFileChange(path), false, path);
  assert.equal(hasUiFileChanges(['README.md', 'src/app.tsx']), true);
  assert.equal(hasUiFileChanges(['README.md', 'src/app.ts']), false);
});

test('UI checks require a UI diff, enabled setting, running service, and browser', () => {
  const base = { enabled: true, serviceRunning: true, browserAvailable: true };
  assert.equal(shouldRunUiCheck({ ...base, files: ['src/App.tsx'] }), true);
  assert.equal(shouldRunUiCheck({ ...base, files: ['README.md'] }), false);
  assert.equal(shouldRunUiCheck({ ...base, enabled: false, files: ['src/App.tsx'] }), false);
  assert.equal(shouldRunUiCheck({ ...base, serviceRunning: false, files: ['src/App.tsx'] }), false);
  assert.equal(shouldRunUiCheck({ ...base, browserAvailable: false, files: ['src/App.tsx'] }), false);
});

test('automatic UI follow-ups stop after two and reset for user prompts', () => {
  const guard = new UiCheckFollowupGuard();
  assert.equal(guard.canQueue('s_1'), true);
  guard.queued('s_1');
  assert.equal(guard.canQueue('s_1'), true);
  guard.queued('s_1');
  assert.equal(guard.canQueue('s_1'), false);
  guard.reset('s_1');
  assert.equal(guard.count('s_1'), 0);
  assert.equal(guard.canQueue('s_1'), true);
  assert.equal(uiCheckFollowupText({ errors: 2, path: '/settings' }),
    'The UI check after your last turn found 2 errors on /settings. Fix them, then verify with ormi_browser_logs and ormi_browser_screenshot.');
});

test('user prompt entry points reset the automatic follow-up count, but MCP does not', () => {
  assert.equal(shouldResetUiCheckFollowups('desktop'), true);
  assert.equal(shouldResetUiCheckFollowups('mcp'), false);
});

test('capped UI check results are journaled without enqueuing another follow-up', () => {
  const guard = new UiCheckFollowupGuard();
  guard.queued('s_1');
  guard.queued('s_1');
  const events = [];
  let queued = false;
  const followup = recordUiCheckResult('s_1', {
    errors: 3, warnings: 0, path: '/', checkpoint: 'cp', artifact: 'bl', url: 'http://localhost/',
    consoleIds: ['c1'], entries: [],
  }, guard, () => { queued = true; }, (_session, kind, payload) => events.push({ kind, payload }));
  assert.equal(followup, false);
  assert.equal(queued, false);
  assert.equal(events[0].kind, 'ui_check');
  assert.equal(events[0].payload.followup, false);
});
