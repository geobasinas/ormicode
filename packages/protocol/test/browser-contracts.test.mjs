import assert from 'node:assert/strict';
import test from 'node:test';
import { newId, parseEventBody, parseRequestBody, parseResponseBody } from '../src/index.ts';

test('browser requests and responses are contract-checked', () => {
  const session = newId('s');
  const artifact = newId('bl');
  assert.equal(parseRequestBody('browser.status', {}).success, true);
  assert.equal(parseRequestBody('browser.install', {}).success, true);
  assert.equal(parseRequestBody('browser.setSettings', { checkpointScreenshots: true, uiCheck: true }).success, true);
  assert.equal(parseRequestBody('browser.setSettings', { checkpointScreenshots: true }).success, false);
  assert.equal(parseRequestBody('browser.open', { session, port: 41001, device: 'phone' }).success, true);
  assert.equal(parseRequestBody('browser.click', { session, selector: 'role=button[name="Save"]' }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: artifact }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: artifact, offset: 524288, length: 524288 }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: artifact, length: 524289 }).success, false);
  assert.equal(parseResponseBody('browser.artifact', { mime: 'image/png', data: 'AA==', size: 1, offset: 0 }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: '../store.db' }).success, false);
  assert.equal(parseRequestBody('browser.diff', { session, a: artifact, b: newId('bl') }).success, true);
  assert.equal(parseRequestBody('browser.diff', { session, a: artifact, b: '../store.db' }).success, false);
  assert.equal(parseResponseBody('browser.status', { available: false, source: null }).success, true);
  assert.equal(parseResponseBody('browser.settings', { checkpointScreenshots: true, uiCheck: true }).success, true);
  assert.equal(parseResponseBody('browser.screenshot', { url: 'http://localhost/', title: 'Fixture', consoleErrors: 0, artifact, jpeg: 'AA==' }).success, true);
  assert.equal(parseResponseBody('browser.diff', { artifact, changed: 1, total: 2, percent: 50, width: 2, height: 1 }).success, true);
  assert.equal(parseEventBody({ kind: 'browser_action', action: 'click', target: '#save', url: 'http://localhost/', ok: true, actor: 'agent' }).success, true);
  assert.equal(parseEventBody({ kind: 'checkpoint_screenshot', checkpoint: newId('bl'), artifact, url: 'http://localhost/', actor: 'auto' }).success, true);
  assert.equal(parseEventBody({ kind: 'ui_check', checkpoint: newId('bl'), artifact, url: 'http://localhost/', errors: 0, warnings: 0, entries: [], actor: 'auto' }).success, true);
  assert.equal(parseEventBody({ kind: 'ui_check', checkpoint: newId('bl'), artifact, url: 'http://localhost/', errors: 1, warnings: 0, entries: [], followup: true, actor: 'auto' }).success, true);
});
