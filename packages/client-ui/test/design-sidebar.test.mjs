import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

const hook = registerHooks({ load(url, context, next) {
  if (!url.endsWith('.tsx')) return next(url, context);
  return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
} });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
  if (!dom.window.Element.prototype[name]) dom.window.Element.prototype[name] = () => false;
}
if (!dom.window.Element.prototype.scrollIntoView) dom.window.Element.prototype.scrollIntoView = () => {};

const prompt = 'Make the hero a tall desktop frame and update the type ramp for the marketing page';

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

test('design sidebar polish', async (t) => {
  await t.test('layer labels prefer text or a friendly type, and keep the tag in the tooltip', async () => {
    const { readLayers, layerLabel } = await import('../src/features/design/DesignLayers.tsx');
    const plain = document.createElement('div');
    assert.equal(layerLabel(plain).label, 'Rectangle');
    assert.equal(layerLabel(plain).title, '<div> Rectangle');
    assert.notEqual(layerLabel(plain).label, 'div');

    const named = document.createElement('div');
    named.id = 'hero';
    assert.equal(layerLabel(named).label, 'hero');
    const accessible = document.createElement('section');
    accessible.setAttribute('aria-label', 'Sidebar');
    assert.equal(layerLabel(accessible).label, 'Sidebar');
    const designed = document.createElement('div');
    designed.setAttribute('data-name', 'Card');
    assert.equal(layerLabel(designed).label, 'Card');

    const heading = document.createElement('h2');
    heading.textContent = 'Intro';
    assert.equal(layerLabel(heading).label, 'Intro');
    assert.match(layerLabel(heading).title, /<h2>/);
    const button = document.createElement('button');
    button.textContent = 'Save';
    assert.equal(layerLabel(button).label, 'Save');
    assert.match(layerLabel(button).title, /<button>/);

    const layers = readLayers('<div></div><h2>Intro</h2><button>Save</button><span></span><section></section><div data-name="Card"></div>');
    assert.equal(layers[0].label, 'Rectangle');
    assert.match(layers[0].title, /<div>/);
    assert.notEqual(layers[0].label, 'div');
    assert.equal(layers[1].label, 'Intro');
    assert.equal(layers[2].label, 'Save');
    assert.equal(layers[3].label, 'Text');
    assert.match(layers[3].title, /<span>/);
    assert.equal(layers[4].label, 'Frame');
    assert.equal(layers[5].label, 'Card');
    assert.equal(readLayers('<div>Hero copy</div>')[0].label, 'Hero copy');
  });

  await t.test('arrow keys move between visible layer rows without losing click or fit', async () => {
    const { DesignLayers } = await import('../src/features/design/DesignLayers.tsx');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root'));
    const frame = { id: 'desktop', name: 'Desktop 1', html: '<div></div><button>Save</button>', width: 1280, height: 800, x: 0, y: 0 };
    const other = { id: 'phone', name: 'Phone', html: '<p>Hidden until expanded</p>', width: 390, height: 844, x: 0, y: 0 };
    const clicks = [];
    const fits = [];
    try {
      await act(async () => root.render(createElement(DesignLayers, {
        frames: [],
        onFrame: () => false,
        onElement: () => {},
        onReveal: () => {},
      })));
      const empty = document.querySelector('.design-list-note');
      assert.equal(empty.textContent, 'Frames and elements appear here.');
      assert.equal(empty.hidden, false);

      await act(async () => root.render(createElement(DesignLayers, {
        frames: [frame, other],
        activeFrame: frame,
        onFrame: () => true,
        onElement: (_id, path) => clicks.push(path),
        onReveal: item => fits.push(item.id),
      })));
      const rows = () => [...document.querySelectorAll('.design-layer-list .design-layer-name')];
      assert.deepEqual(rows().map(row => row.querySelector('span').textContent), ['Desktop 1', 'Rectangle', 'Save', 'Phone']);
      assert.equal(document.querySelector('.design-element-row').title, '<div> Rectangle');
      rows()[0].focus();
      const press = async key => act(async () => {
        document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      await press('ArrowDown');
      assert.equal(document.activeElement, rows()[1]);
      await press('ArrowDown');
      assert.equal(document.activeElement, rows()[2]);
      await press('ArrowDown');
      assert.equal(document.activeElement, rows()[3]);
      await press('ArrowUp');
      assert.equal(document.activeElement, rows()[2]);
      await act(async () => { rows()[2].click(); });
      assert.deepEqual(clicks, ['1']);
      await act(async () => { rows()[0].dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })); });
      assert.deepEqual(fits, ['desktop']);
    } finally {
      await act(async () => root.unmount());
    }
  });

  await t.test('edit rows and session options stay short when the summary is a prompt', async () => {
    const { designEditRow, sessionOptionLabel, sessionOptionTitle, designContextLabel } = await import('../src/features/design/DesignAgentDock.tsx');
    const repeated = designEditRow({ revision: 5, summary: `${prompt} frame.update`, source: 'mcp', originSession: 's1' }, prompt);
    assert.equal(repeated.primary, 'r5 · frame.update');
    assert.equal(repeated.secondary, 'MCP');
    assert.equal(`${repeated.primary} ${repeated.secondary}`.includes(prompt), false);

    const titled = designEditRow({ revision: 4, summary: 'frame.update', originSession: 's1' }, prompt);
    assert.equal(titled.primary, 'r4 · frame.update');
    assert.equal(titled.secondary, 'Session');
    assert.equal(titled.secondary.includes('Make the hero'), false);

    const named = designEditRow({ revision: 2, summary: 'frame.update', originSession: 's1' }, 'Homepage');
    assert.deepEqual(named, { primary: 'r2 · frame.update', secondary: 'Homepage' });
    assert.deepEqual(designEditRow({ revision: 3, summary: 'Rename', originSession: 's1' }, 'Homepage'), { primary: 'r3 · Rename', secondary: 'Homepage' });

    assert.equal(sessionOptionLabel({ id: 's', title: 'Fix the nav', branch: 'fix/issue-5' }), 'Fix the nav · fix/issue-5');
    assert.equal(sessionOptionLabel({ id: 's', title: prompt, branch: 'feature/very-long-branch-name' }), prompt);
    assert.equal(sessionOptionLabel({ id: 's', title: 'Nav', branch: 'main' }).includes('ormicode'), false);
    assert.match(sessionOptionTitle({ id: 's', title: 'Fix the nav', project: '/workspace/ormicode', branch: 'main', cwd: '/workspace/ormicode' }), /Fix the nav · ormicode · main/);
    assert.equal(designContextLabel({ slug: 'home', name: 'Marketing', revision: 5, frame: { id: 'desktop', name: 'Desktop 1' } }), 'On Desktop 1 · r5');
  });

  await t.test('design composer hides an empty queue and disables send until there is text', async () => {
    let items = [];
    let prompts = 0;
    const transport = {
      request: async method => {
        if (method === 'session.prompt' || method === 'session.queue.add') prompts += 1;
        if (method === 'session.queue.list') return { type: 'res', body: { items } };
        if (method === 'session.draft.get') return { type: 'res', body: { text: '' } };
        if (method === 'models.list') return { type: 'res', body: { models: [] } };
        if (method === 'prompts.history') return { type: 'res', body: { items: [] } };
        return { type: 'res', body: {} };
      },
      subscribeEvents: () => () => {},
    };
    const { PlatformContext } = await import('../src/lib/platform.ts');
    const { Composer } = await import('../src/features/session/Composer.tsx');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root'));
    const details = { id: 'session-1', title: 'Homepage', state: 'idle', project: '/repo', cwd: '/repo', vendor: 'claude', transport: 'sdk', updatedAt: 1, branch: 'main' };
    const render = key => root.render(createElement(PlatformContext.Provider, { value: { kind: 'web', transport, tokens: {}, hubLabel: 'test' } },
      createElement(Composer, { key, session: details.id, details, taskContext: 'Design board: "Home"', compact: true })));
    const show = async key => {
      await act(async () => { render(key); });
      await settle();
      await settle();
    };
    try {
      await show('empty');
      const send = () => document.querySelector('button[aria-label="send"], button[aria-label="Queue follow-up"]');
      assert.equal(document.body.textContent.includes('0 queued'), false);
      assert.equal(send().disabled, true);
      assert.equal(send().getAttribute('aria-disabled'), 'true');
      await act(async () => { send().click(); });
      const area = document.querySelector('textarea[aria-label="prompt"]');
      await act(async () => { area.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
      assert.equal(prompts, 0);

      const prototype = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value');
      await act(async () => {
        prototype.set.call(area, 'Tighten the header');
        area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      assert.equal(send().disabled, false);
      assert.notEqual(send().getAttribute('aria-disabled'), 'true');

      items = [{ id: 'q1', text: 'Follow up on the hero', createdAt: 1 }];
      await show('queued');
      assert.match(document.body.textContent, /1 queued/);
      assert.equal(document.body.textContent.includes('0 queued'), false);
      items = [{ id: 'q1', text: 'Follow up on the hero', createdAt: 1, error: 'rejected' }];
      await show('failed');
      assert.match(document.body.textContent, /1 queued · 1 failed/);
    } finally {
      await act(async () => root.unmount());
      await settle();
    }
  });
});

test.after(() => {
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  dom.window.close();
  hook.deregister();
});
