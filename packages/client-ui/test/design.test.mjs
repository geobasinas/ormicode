import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { BRIDGE_HASH, BRIDGE_SCRIPT, BRIDGE_SRC_DOC } from '../src/features/design/bridge.ts';
import { fitCanvas, fitView, reconcileFrameSelection, resizeRect, validateBridgeMessage, zoomAt } from '../src/features/design/design-model.ts';
import { snapFrame } from '../src/features/design/design-snap.ts';
import { hexFromComputedColor, validateStyleEdit } from '../src/features/design/design-style.ts';

test('canvas transforms, resize bounds and style/bridge allowlists', () => {
  assert.deepEqual(fitView([], 900, 700), { x: 0, y: 0, scale: 1 });
  assert.equal(reconcileFrameSelection([{ id: 'one' }, { id: 'two' }], 'two'), 'two');
  assert.equal(reconcileFrameSelection([{ id: 'one' }], 'deleted'), 'one');
  assert.equal(reconcileFrameSelection([], 'deleted'), '');
  assert.equal(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 50 }, 2).scale, 2);
  assert.ok(fitView([{ x: 0, y: 0, width: 1440, height: 900 }], 900, 700).scale < 1);
  const fitted = fitCanvas([{ x: 0, y: 0, width: 390, height: 844 }], 1600, 900);
  assert.ok(fitted.y + 844 * fitted.scale <= 900 - 70, 'artboard stays above the floating controls and its caption');
  assert.equal(resizeRect({ x: 0, y: 0, width: 100, height: 100 }, -500, 500).width, 80);
  assert.equal(resizeRect({ x: 0, y: 0, width: 100, height: 100 }, 5000, 0).width, 4096);
  assert.equal(validateStyleEdit('color', 'var(--accent-mint)'), true);
  assert.equal(validateStyleEdit('backgroundImage', 'url(https://example.invalid)'), false);
  assert.equal(validateStyleEdit('color', 'red;display:none'), false);
  assert.equal(validateStyleEdit('opacity', '0.75'), true);
  assert.equal(validateStyleEdit('opacity', '1.5'), false);
  assert.equal(validateStyleEdit('borderColor', '#abcdef8'), false);
  assert.equal(validateStyleEdit('fontWeight', ''), true);
  assert.equal(hexFromComputedColor('rgba(12, 34, 56, 0.5)'), '#0c223880');
  const selection = { channel: 'abc', type: 'selected', id: 'n1', path: '0.2', tag: 'p', leaf: true, text: 'Hi', styles: { color: 'red' }, computed: { color: 'rgb(255, 0, 0)' } };
  assert.equal(validateBridgeMessage(selection, 'abc'), true);
  assert.equal(validateBridgeMessage({ ...selection, path: '0.__proto__' }, 'abc'), false);
  assert.equal(validateBridgeMessage({ ...selection, extra: true }, 'abc'), false);
  assert.equal(validateBridgeMessage({ ...selection, computed: { width: 'a'.repeat(121) } }, 'abc'), false);
  assert.equal(validateBridgeMessage({ channel: 'wrong', type: 'serialized', html: '' }, 'abc'), false);
});

test('frame snaps use screen-pixel tolerance, emit alignment guides and preserve geometry bounds', () => {
  const rect = { x: 102, y: 4, width: 100, height: 80 };
  const target = { x: 0, y: 0, width: 100, height: 100 };
  const snapped = snapFrame(rect, [target], 'move', 1);
  assert.deepEqual(snapped.rect, { ...rect, x: 100, y: 0 });
  assert.deepEqual(snapped.guides, [
    { axis: 'x', at: 100, from: 0, to: 100 },
    { axis: 'y', at: 0, from: 0, to: 200 },
  ]);
  assert.equal(snapFrame(rect, [target], 'move', 3).rect.y, 4);
  const resized = snapFrame({ ...rect, width: 198, height: 92 }, [{ ...target, x: 300 }], 'resize', 1);
  assert.deepEqual(resized.rect, { ...rect, width: 198, height: 96 });
  assert.equal(snapFrame({ ...target, width: 80 }, [{ ...target, x: 77, width: 900 }], 'resize', 1).rect.width, 80);
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
    command({ type: 'init', html: '<section><p>Hello</p><span>World</span></section>', styles: 'p { color: rgb(12, 34, 56); opacity: 0.5 }' });
    command({ type: 'selectPath', path: '0.1' }, 'https://wrong.invalid');
    assert.equal(selected(), undefined);
    command({ type: 'selectPath', path: '0.10000.0' });
    command({ type: 'selectPath', path: '0.__proto__' });
    assert.equal(selected(), undefined);
    command({ type: 'selectPath', path: '0.0' });
    assert.equal(selected().path, '0.0');
    assert.equal(selected().text, 'Hello');
    assert.equal(selected().leaf, true);
    assert.equal(selected().styles.opacity, '');
    assert.equal(selected().computed.opacity, '0.5');
    command({ type: 'editText', id: selected().id, text: 'Rejected', extra: true });
    command({ type: 'editText', id: selected().id, text: 'Rejected' }, 'https://wrong.invalid');
    assert.equal(window.document.querySelector('p').textContent, 'Hello');
    command({ type: 'editText', id: selected().id, text: 'Updated' });
    assert.equal(window.document.querySelector('p').textContent, 'Updated');
    command({ type: 'editStyle', id: selected().id, property: 'position', value: 'fixed' });
    assert.equal(window.document.querySelector('p').style.position, '');
    command({ type: 'editStyle', id: selected().id, property: 'color', value: 'var(--accent-mint)' });
    assert.equal(window.document.querySelector('p').style.color, 'var(--accent-mint)');
    command({ type: 'editStyle', id: selected().id, property: 'opacity', value: '0.8' });
    assert.equal(selected().computed.opacity, '0.8');
    command({ type: 'editStyle', id: selected().id, property: 'opacity', value: '1.5' });
    assert.equal(selected().computed.opacity, '0.8');
    command({ type: 'editStyle', id: selected().id, property: 'opacity', value: '' });
    assert.equal(selected().styles.opacity, '');
    assert.equal(selected().computed.opacity, '0.5');
    window.document.querySelector('section').click();
    assert.equal(selected().leaf, false);
    assert.equal(selected().path, '0');
    command({ type: 'editText', id: selected().id, text: 'Would destroy children' });
    assert.ok(window.document.querySelector('section p'));
    command({ type: 'addElement', kind: 'button' });
    assert.equal(window.document.querySelector('#root > button').type, 'button');
    const serialized = sent.findLast(message => message.type === 'serialized').html;
    assert.match(serialized, /Updated/);
    assert.doesNotMatch(serialized, /data-ormi-node|script|2147483647/);
  } finally { window.close(); }
});
