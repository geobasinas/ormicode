import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { BRIDGE_SCRIPT } from '../src/features/design/bridge.ts';
import { validateBridgeMessage } from '../src/features/design/design-model.ts';
import { frameMarkupWithToken, renderDesignTokenStyles } from '../src/features/design/design-inspector-model.ts';

const token = { name: 'brand', kind: 'color', value: '#173eac' };
const binding = 'var(--ormi-design-brand)';
const channel = 'a-test-channel-with-enough-characters';

function bridgeSession() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  const messages = [];
  window.postMessage = message => messages.push(message);
  window.CSS ??= {};
  window.CSS.escape = String;
  new Script(BRIDGE_SCRIPT).runInContext(dom.getInternalVMContext());
  const send = body => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: 'https://host.invalid', data: { channel, ...body } }));
  send({ type: 'init', editable: true, interactive: true, stamp: 7, html: '<section><div id="layer" style="width: 40px"><b>Chosen child</b></div><p>Other layer</p></section>',
    styles: '#layer { color: rgb(12, 34, 56); opacity: 0.5 } #layer b { font-size: 22px }', tokenStyles: renderDesignTokenStyles([token]) });
  send({ type: 'selectPath', path: '0.0' });
  const last = type => messages.findLast(message => message.type === type);
  return { window, send, last, messages, layer: window.document.querySelector('#layer') };
}

test('element editing commits text and embedded images through the selected layer', () => {
  const { window, send, last, messages, layer } = bridgeSession();
  const source = 'data:image/png;base64,AAAA';
  const replacement = 'data:image/webp;base64,BBBB';
  try {
    const section = layer.parentElement;
    const paragraph = section.querySelector('p');
    paragraph.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(paragraph.getAttribute('contenteditable'), 'plaintext-only');
    paragraph.textContent = 'Try another title';
    paragraph.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(paragraph.textContent, 'Other layer');
    assert.equal(last('serialized'), undefined);
    paragraph.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    paragraph.textContent = '<strong>A title</strong>';
    paragraph.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(last('serialized').stamp, 7);
    assert.match(last('serialized').html, /&lt;strong&gt;A title&lt;\/strong&gt;/);
    assert.doesNotMatch(last('serialized').html, /contenteditable|data-ormi-node/);
    assert.ok(validateBridgeMessage(last('serialized'), channel));

    const paragraphId = last('selected').id;
    send({ type: 'addElement', id: paragraphId, kind: 'image', source: 'data:image/svg+xml;base64,AAAA' });
    assert.equal(section.querySelector('img'), null);
    send({ type: 'addElement', id: paragraphId, kind: 'image', source });
    const img = section.querySelector('img');
    assert.equal(paragraph.nextElementSibling, img);
    const imageId = last('selected').id;
    send({ type: 'replaceImage', id: paragraphId, source: replacement });
    assert.equal(img.getAttribute('src'), source);
    send({ type: 'replaceImage', id: imageId, source: replacement });
    send({ type: 'imageAlt', id: imageId, alt: 'A wind turbine' });
    send({ type: 'editStyles', id: imageId, patch: { objectFit: 'cover', objectPosition: '20% 45%' } });
    assert.equal(img.getAttribute('src'), replacement);
    assert.equal(img.alt, 'A wind turbine');
    assert.equal(img.style.objectPosition, '20% 45%');
    assert.equal(last('selected').alt, 'A wind turbine');
    send({ type: 'manageLayer', id: imageId, action: 'duplicate' });
    assert.equal(section.querySelectorAll('img').length, 2);
    send({ type: 'manageLayer', id: last('selected').id, action: 'remove' });
    assert.equal(section.querySelectorAll('img').length, 1);

    const saved = messages.filter(message => message.type === 'serialized').length;
    send({ type: 'configureEditor', editable: false, interactive: false });
    send({ type: 'manageLayer', id: last('selected').id, action: 'remove' });
    paragraph.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(paragraph.hasAttribute('contenteditable'), false);
    assert.equal(messages.filter(message => message.type === 'serialized').length, saved);
  } finally { window.close(); }
});

test('inspector bridge applies bounded edit batches, keeps authored and computed values separate, and aligns within the parent', () => {
  const { window, send, last, messages, layer } = bridgeSession();
  try {
    const selected = last('selected');
    assert.ok(validateBridgeMessage(selected, channel));
    assert.equal(selected.styles.color, '');
    assert.equal(selected.computed.color, 'rgb(12, 34, 56)');
    assert.equal(selected.styles.width, '40px');
    const { id } = selected;
    const patch = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', paddingRight: '8px', rotate: '45deg', borderLeftStyle: 'dashed', borderLeftWidth: '2px', borderLeftColor: binding };
    const count = messages.filter(message => message.type === 'serialized').length;
    send({ type: 'editStyles', id, patch });
    assert.equal(last('selected').id, id);
    for (const [property, value] of Object.entries(patch)) assert.equal(layer.style[property], value);
    assert.equal(layer.style.borderRightStyle, '');
    assert.equal(messages.filter(message => message.type === 'serialized').length, count + 1);
    send({ type: 'editStyles', id, patch: { opacity: '0.75', backgroundImage: 'url("https://example.invalid/image.png")' } });
    assert.equal(last('selected').computed.opacity, '0.5', 'an invalid entry rejects the whole batch');
    send({ type: 'editStyles', id, patch: { visibility: 'hidden', paddingTop: 'var(--outside-scope)' } });
    assert.equal(layer.style.visibility, '');
    send({ type: 'editStyles', id: 'n999', patch: { opacity: '0.7' } });
    assert.equal(layer.style.opacity, '');
    Object.defineProperty(layer.parentElement, 'clientWidth', { value: 200 });
    layer.parentElement.getBoundingClientRect = () => ({ left: 10, top: 0 });
    layer.getBoundingClientRect = () => ({ left: 45, top: 0, width: 40, height: 24 });
    send({ type: 'alignElement', id, axis: 'x', alignment: 'center' });
    assert.equal(layer.style.position, 'relative');
    assert.equal(layer.style.left, '45px');
    send({ type: 'editStyles', id, patch: { position: 'fixed', zIndex: '5' } });
    assert.equal(layer.style.zIndex, '5');
    assert.equal(layer.style.position, 'fixed');
    assert.match(last('serialized').html, /border-left-color: var\(--ormi-design-brand\)/);
    send({ type: 'setTokenStyles', tokenStyles: ':root{--ormi-design-brand:blue}body{display:none}' });
    const tokenSheet = window.document.head.querySelector('#design-tokens');
    assert.equal(tokenSheet.textContent, renderDesignTokenStyles([token]));
    send({ type: 'setTokenStyles', tokenStyles: renderDesignTokenStyles([{ ...token, value: '#ffee77' }]) });
    assert.match(tokenSheet.textContent, /#ffee77/);
  } finally { window.close(); }
});

test('layer export contains only the selected subtree with computed presentation and a restrictive CSP', async () => {
  const { window, send, last } = bridgeSession();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  try {
    const { buildDesignLayerDocument } = await import('../src/features/design/design-layer-export.ts');
    send({ type: 'exportLayer', id: last('selected').id });
    const result = last('layerExport');
    assert.ok(validateBridgeMessage(result, channel));
    assert.match(result.html, /Chosen child/);
    assert.match(result.html, /font-size: 22px/);
    assert.match(result.html, /color: rgb\(12, 34, 56\)/);
    assert.doesNotMatch(result.html, /Other layer|data-ormi-node|<section/);
    assert.equal(buildDesignLayerDocument(''), undefined);
    const html = buildDesignLayerDocument(result.html + '<style>p{color:red}</style><img src="https://example.invalid/x" onerror="x()"><script>x()</script>');
    assert.match(html, /default-src 'none'; img-src data:/);
    assert.match(html, /Chosen child/);
    assert.doesNotMatch(html, /<script|example\.invalid|onerror|p\{color:red\}/);
    assert.equal(validateBridgeMessage({ ...result, html: 'x'.repeat(100_000) }, channel), false);

    const frame = '<main><p>Before</p><p>Bind this</p></main>';
    assert.equal(frameMarkupWithToken(frame, '0.1', 'div', 'color', binding), undefined);
    assert.equal(frameMarkupWithToken(frame, '0.9', 'p', 'color', binding), undefined);
    const bound = frameMarkupWithToken(frame, '0.1', 'p', 'color', binding);
    assert.equal(bound, '<main><p>Before</p><p style="color: var(--ormi-design-brand);">Bind this</p></main>');
  } finally {
    for (const key of ['window', 'document', 'HTMLElement', 'SVGElement']) delete globalThis[key];
    window.close();
  }
});
