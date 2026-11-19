import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesOf, pageOfFrame, framesOnPage, startFrameOf } from '../src/features/design/design-pages.ts';
import { gridStep, rulerTicks, documentToScreen, screenToDocument, guideAxisFromRuler, isGuideRemoval } from '../src/features/design/design-rulers.ts';
import { snapFrame } from '../src/features/design/design-snap.ts';

test('top ruler creates horizontal guides and left ruler creates vertical guides; remove only over own ruler', () => {
  assert.equal(guideAxisFromRuler('x'), 'y');
  assert.equal(guideAxisFromRuler('y'), 'x');
  for (const axis of ['x', 'y']) {
    const own = axis === 'x' ? { x: 10, y: 100 } : { x: 100, y: 10 };
    const other = axis === 'x' ? { x: 100, y: 10 } : { x: 10, y: 100 };
    assert.equal(isGuideRemoval(axis, own, true), true);
    assert.equal(isGuideRemoval(axis, other, true), false);
    assert.equal(isGuideRemoval(axis, own, false), false);
    assert.equal(isGuideRemoval(axis, { x: -10, y: -10 }, true), false);
    assert.equal(isGuideRemoval(axis, { x: 100, y: 100 }, true), false);
  }
});

test('legacy pages, page filtering and explicit or top-left start', () => {
  const frames = [{ id: 'one', x: 40, y: 20 }, { id: 'two', x: -5, y: 20 }, { id: 'three', pageId: 'other', x: 0, y: 0 }];
  assert.equal(pagesOf(null)[0].id, 'default');
  assert.equal(pageOfFrame(frames[0]), 'default');
  assert.equal(framesOnPage(frames, 'default').length, 2);
  assert.equal(startFrameOf({ id: 'default' }, frames).id, 'two');
  assert.equal(startFrameOf({ id: 'default', startFrameId: 'one' }, frames).id, 'one');
  assert.equal(startFrameOf({ id: 'empty' }, frames), undefined);
});
test('rulers are zoom aware with aligned major and minor ticks', () => {
  for (const scale of [.1, .5, 1, 2, 4]) {
    const step = gridStep(scale);
    assert.ok(step * scale >= 80 && step * scale <= 200);
    const ticks = rulerTicks(800, -23, scale);
    assert.ok(ticks.some(tick => tick.major) && ticks.some(tick => !tick.major));
    for (const tick of ticks) assert.equal(tick.screen, documentToScreen(tick.at, -23, scale));
    assert.equal(screenToDocument(documentToScreen(125, -23, scale), -23, scale), 125);
  }
  assert.deepEqual(rulerTicks(-1, 0, 1), []);
});
test('guides snap move and resize without changing default or distant geometry', () => {
  const rect = { x: 3, y: 7, width: 100, height: 100 };
  assert.deepEqual(snapFrame(rect, [], 'move', 1).rect, rect);
  assert.equal(snapFrame(rect, [], 'move', 1, [{ axis: 'x', at: 0 }]).rect.x, 0);
  assert.equal(snapFrame(rect, [], 'resize', 1, [{ axis: 'x', at: 110 }]).rect.width, 107);
  assert.deepEqual(snapFrame(rect, [], 'move', 1, [{ axis: 'x', at: 1000 }]).rect, rect);
});
