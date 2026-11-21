import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAccountStorage } from '../src/account-storage.ts';

function storage(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => value() });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
}

test('sign-out clears frame HTML/CSS and all app-owned account caches without touching other apps', t => {
  const data = new Map([
    ['ormicode.design.frameClipboard', '{"html":"private","styles":"secret"}'],
    ['ormi.browser.annotation.session.page', 'private screenshot'],
    ['ormi.browser.history.project', 'private URL'],
    ['ormi.term.session', 'terminal IDs'],
    ['ormi.workspaceMode:/private/path', 'folder'],
    ['ormi.digest.since', '1'],
    ['ormi.other', '{"private":true}'],
    ['another-app', 'untouched'],
  ]);
  storage(t, () => ({ get length() { return data.size; }, key: index => [...data.keys()][index], removeItem: key => data.delete(key) }));
  clearAccountStorage();
  assert.deepEqual([...data], [['another-app', 'untouched']]);
  clearAccountStorage();
  assert.equal(data.size, 1);
});

test('sign-out tolerates absent or blocked localStorage', t => {
  let blocked = false;
  storage(t, () => { if (blocked) throw new Error('SecurityError'); });
  assert.doesNotThrow(clearAccountStorage);
  blocked = true;
  assert.doesNotThrow(clearAccountStorage);
});
