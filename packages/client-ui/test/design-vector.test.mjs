import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { designOperationSchema } from '../../protocol/src/design.ts';
import {
  documentPoint, drawingFrame, MAX_STROKE_POINTS, mirroredAnchor, parseEditablePath,
  pathData, replaceAnchor, sampleStroke, shapeEnd,
} from '../src/features/design/vector-geometry.ts';

test('viewport conversion and reversed drags preserve actual document-space geometry', () => {
  const start = documentPoint({ x: 370, y: 194 }, { x: 100, y: 40 }, { x: 30, y: -6, scale: 2 });
  assert.deepEqual(start, { x: 120, y: 80 });
  const end = shapeEnd(start, { x: 20, y: 140 }, true, false);
  assert.deepEqual(end, { x: 20, y: 180 });
  const rectangle = drawingFrame('rectangle', { anchors: [start, end], closed: false });
  assert.deepEqual([rectangle.x, rectangle.y, rectangle.width, rectangle.height], [17, 77, 106, 106]);
  assert.match(rectangle.html, /<rect x="3" y="3" width="100" height="100"/);
  assert.equal(designOperationSchema.safeParse({ type: 'frame.add', ...rectangle }).success, true);
  assert.equal(drawingFrame('line', { anchors: [start, { x: 5000, y: 20 }], closed: false }), null);
});

test('closed cubic geometry round trips and moving an anchor preserves its handle offsets', () => {
  const start = mirroredAnchor({ x: 10, y: 15 }, { x: 20, y: 25 });
  const middle = { x: 60, y: 70 };
  const end = mirroredAnchor({ x: 30, y: 75 }, { x: 25, y: 90 });
  const path = { anchors: [start, middle, end], closed: true };
  assert.equal(pathData(path), 'M 10 15 C 20 25 60 70 60 70 C 60 70 35 60 30 75 C 25 90 0 5 10 15 Z');
  assert.deepEqual(parseEditablePath(pathData(path)), path);
  const moved = replaceAnchor(path, 2, 'anchor', { x: 40, y: 55 }, false);
  assert.deepEqual(moved.anchors[2], { x: 40, y: 55, incoming: { x: 45, y: 40 }, outgoing: { x: 35, y: 70 } });
  assert.deepEqual(replaceAnchor(moved, 2, 'outgoing', { x: 10, y: 20 }, true).anchors[2].incoming, { x: 70, y: 90 });
  assert.equal(parseEditablePath('M 10 20 A 5 5 0 0 1 15 25'), null);
  assert.equal(parseEditablePath('M 10 20 C 4 5 6'), null);
});

test('long freehand strokes stay within caps and keep first and last samples', () => {
  let anchors = [];
  for (let x = 0; x < MAX_STROKE_POINTS * 3; x++) anchors = sampleStroke(anchors, { x, y: x % 40 }, 1);
  assert.ok(anchors.length <= MAX_STROKE_POINTS);
  assert.deepEqual(anchors[0], { x: 0, y: 0 });
  assert.equal(anchors.at(-1).x, MAX_STROKE_POINTS * 3 - 1);
  const frame = drawingFrame('freehand', { anchors, closed: false });
  assert.ok(frame.html.length < 8192);
  assert.match(frame.html, /<path d="M 3 3 L/);
});

test('SVG sanitizer retains bounded geometry without executable, resource or unchecked metadata', async () => {
  const dom = new JSDOM('');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const { sanitizeMarkup, standaloneSvg } = await import('../src/features/design/sanitize.ts');
    const clean = sanitizeMarkup('<svg viewBox="0 0 100 80" width="100%" data-ormi-path="untrusted" onload="x()"><title>Sample</title><desc>' +
      'x'.repeat(300) + '</desc><g transform="translate(2,3)"><path d="M0 0 C10 30 40 10 70 60" stroke="#333" fill="url(https://remote.invalid/a)" onclick="x()"/></g>' +
      '<foreignObject><p>unsafe</p></foreignObject><a href="https://remote.invalid/"><circle r="20"/></a>' +
      '<use href="#item"/><image href="data:image/png;base64,AA=="/><animate attributeName="href" to="https://remote.invalid/"/><script>x()</script>' +
      '<rect style="fill:url(https://remote.invalid/)" id="unsafe" width="1e100" height="12"/></svg>');
    assert.match(clean, /viewBox="0 0 100 80"/);
    assert.match(clean, /<title>Sample<\/title>/);
    assert.match(clean, /transform="translate\(2,3\)"/);
    assert.match(clean, /<path d="M0 0 C10 30 40 10 70 60" stroke="#333"><\/path>/);
    assert.match(clean, /<rect height="12"><\/rect>/);
    assert.doesNotMatch(clean, /data-ormi|onload|onclick|href|remote|foreignObject|image|animate|script|1e100|unsafe/);
    assert.equal(standaloneSvg(clean).querySelector('desc').textContent.length, 240);
    assert.equal(standaloneSvg('<p>Not standalone</p>' + clean), null);
    const standalone = drawingFrame('pen', { anchors: [{ x: 35, y: 60 }, { x: 70, y: 90 }], closed: false });
    assert.equal(standaloneSvg(standalone.html).querySelector('path').getAttribute('d'), 'M 3 3 L 38 33');
    assert.equal(sanitizeMarkup(sanitizeMarkup(standalone.html)), sanitizeMarkup(standalone.html));

    const { cleanRichText, richBody, richMarkup } = await import('../src/features/design/vector-rich-text.ts');
    const formatted = cleanRichText('<p style="color:red"><b>Bold</b> <i>Italic</i><br><img src="about:blank"><script>bad()</script>&lt;p&gt;</p><ul><li><u>Item</u></li></ul>');
    assert.equal(formatted, '<p><b>Bold</b> <i>Italic</i><br>&lt;p&gt;</p><ul><li><u>Item</u></li></ul>');
    assert.equal(richBody(richMarkup(formatted)), formatted);
    assert.equal(richBody('<p>Plain text</p>'), null);
    assert.equal(cleanRichText('x'.repeat(8193)), null);
    assert.equal(cleanRichText('<div>'.repeat(20) + 'text' + '</div>'.repeat(20)), null);
  } finally {
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
  }
});
