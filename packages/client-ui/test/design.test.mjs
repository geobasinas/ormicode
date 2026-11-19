import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { BRIDGE_HASH, BRIDGE_SCRIPT, BRIDGE_SRC_DOC } from '../src/features/design/bridge.ts';
import { fitView, reconcileFrameSelection, resizeRect, validateBridgeMessage, validateStyleEdit, zoomAt } from '../src/features/design/design-model.ts';

test('canvas transforms, resize bounds and style/bridge allowlists', () => {
  assert.deepEqual(fitView([], 900, 700), { x: 0, y: 0, scale: 1 });
  assert.equal(reconcileFrameSelection([{ id: 'one' }, { id: 'two' }], 'two'), 'two');
  assert.equal(reconcileFrameSelection([{ id: 'one' }], 'deleted'), 'one');
  assert.equal(reconcileFrameSelection([], 'deleted'), '');
  assert.equal(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 50 }, 2).scale, 2);
  assert.ok(fitView([{ x: 0, y: 0, width: 1440, height: 900 }], 900, 700).scale < 1);
  assert.equal(resizeRect({ x: 0, y: 0, width: 100, height: 100 }, -500, 500).width, 80);
  assert.equal(resizeRect({ x: 0, y: 0, width: 100, height: 100 }, 5000, 0).width, 4096);
  assert.equal(validateStyleEdit('color', 'var(--accent-mint)'), true);
  assert.equal(validateStyleEdit('backgroundImage', 'url(https://example.invalid)'), false);
  assert.equal(validateStyleEdit('color', 'red;display:none'), false);
  assert.equal(validateBridgeMessage({ channel: 'abc', type: 'selected', id: 'n1', tag: 'p', leaf: true, text: 'Hi', styles: { color: 'red' } }, 'abc'), true);
  assert.equal(validateBridgeMessage({ channel: 'abc', type: 'selected', id: 'n1', tag: 'p', leaf: true, text: 'Hi', styles: { color: 'red' }, extra: true }, 'abc'), false);
  assert.equal(validateBridgeMessage({ channel: 'wrong', type: 'serialized', html: '' }, 'abc'), false);
});

test('fixed iframe bridge hash and DOMPurify strip executable/navigation content', async () => {
  assert.doesNotThrow(() => new Script(BRIDGE_SCRIPT));
  assert.equal(createHash('sha256').update(BRIDGE_SCRIPT).digest('base64'), BRIDGE_HASH);
  assert.ok(readFileSync(new URL('../../../apps/desktop/src/renderer/index.html', import.meta.url), 'utf8').includes(`sha256-${BRIDGE_HASH}`));
  assert.match(BRIDGE_SRC_DOC, new RegExp(`sha256-${BRIDGE_HASH.replace(/[+/=]/g, '\\$&')}`));
  const dom = new JSDOM('');
  globalThis.window = dom.window;
  const { sanitizeMarkup } = await import('../src/features/design/sanitize.ts');
  assert.equal(sanitizeMarkup(''), '');
  const clean = sanitizeMarkup('<script>alert(1)</script><img src="https://example.invalid/x" onerror="alert(1)"><a href="https://example.invalid">go</a><p onclick="x()">safe</p>');
  assert.doesNotMatch(clean, /script|onerror|onclick|example\.invalid|<a/i);
  assert.match(clean, /<p>safe<\/p>/);
  dom.window.close();
  delete globalThis.window;
});

test('trusted bridge edits only leaf text, validates commands and omits runtime artifacts', () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  const sent = [];
  window.postMessage = message => { sent.push(message); };
  window.CSS ??= {};
  window.CSS.escape = value => value;
  new Script(BRIDGE_SCRIPT).runInContext(dom.getInternalVMContext());
  const channel = 'a-test-channel-with-enough-characters';
  const command = (body, origin = 'https://host.invalid') => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin, data: { channel, ...body } }));
  const selected = () => sent.findLast(message => message.type === 'selected');
  try {
    command({ type: 'init', html: '<section><p>Hello</p><span>World</span></section>', styles: '' });
    window.document.querySelector('p').click();
    assert.equal(selected().leaf, true);
    command({ type: 'editText', id: selected().id, text: 'Rejected', extra: true });
    command({ type: 'editText', id: selected().id, text: 'Rejected' }, 'https://wrong.invalid');
    assert.equal(window.document.querySelector('p').textContent, 'Hello');
    command({ type: 'editText', id: selected().id, text: 'Updated' });
    assert.equal(window.document.querySelector('p').textContent, 'Updated');
    command({ type: 'editStyle', id: selected().id, property: 'position', value: 'fixed' });
    assert.equal(window.document.querySelector('p').style.position, '');
    command({ type: 'editStyle', id: selected().id, property: 'color', value: 'var(--accent-mint)' });
    assert.equal(window.document.querySelector('p').style.color, 'var(--accent-mint)');
    window.document.querySelector('section').click();
    assert.equal(selected().leaf, false);
    command({ type: 'editText', id: selected().id, text: 'Would destroy children' });
    assert.ok(window.document.querySelector('section p'));
    command({ type: 'addElement', kind: 'button' });
    assert.equal(window.document.querySelector('#root > button').type, 'button');
    const serialized = sent.findLast(message => message.type === 'serialized').html;
    assert.match(serialized, /Updated/);
    assert.doesNotMatch(serialized, /data-ormi-node|script|2147483647/);
  } finally { window.close(); }
});
