import assert from 'node:assert/strict';
import test from 'node:test';
import { newId, parseEventBody, parseRequestBody, parseResponseBody } from '../src/index.ts';

test('browser requests and responses are contract-checked', () => {
  const session = newId('s');
  const artifact = newId('bl');
  assert.equal(parseRequestBody('browser.status', {}).success, true);
  assert.equal(parseRequestBody('browser.install', {}).success, true);
  assert.equal(parseRequestBody('browser.open', { session, port: 41001, device: 'phone' }).success, true);
  assert.equal(parseRequestBody('browser.click', { session, selector: 'role=button[name="Save"]' }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: artifact }).success, true);
  assert.equal(parseRequestBody('browser.artifact', { session, id: '../store.db' }).success, false);
  assert.equal(parseResponseBody('browser.status', { available: false, source: null }).success, true);
  assert.equal(parseResponseBody('browser.screenshot', { url: 'http://localhost/', title: 'Fixture', consoleErrors: 0, artifact, jpeg: 'AA==' }).success, true);
  assert.equal(parseEventBody({ kind: 'browser_action', action: 'click', target: '#save', url: 'http://localhost/', ok: true, actor: 'agent' }).success, true);
  assert.equal(parseEventBody({ kind: 'checkpoint_screenshot', checkpoint: newId('bl'), artifact, url: 'http://localhost/', actor: 'auto' }).success, true);
});
