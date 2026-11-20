import test from 'node:test';
import assert from 'node:assert/strict';

export function browseResult(body) {
  const path = body.path ?? '/home/web';
  const names = path === '/home/web' ? ['repo', 'denied'] : path === '/home/web/repo' ? ['child', '.hidden'] : [];
  return { machine: body.machine, path, parent: path.slice(0, path.lastIndexOf('/')) || '/', home: '/home/web', truncated: false,
    entries: names.filter(name => body.hidden || !name.startsWith('.')).map(name => ({ name, path: `${path}/${name}`, git: false, hidden: name.startsWith('.') })) };
}

export function registerProjectTests(environment) {
  test('project picker retains case-distinct paths and removes exact duplicates', async t => {
    const { browser, hub, webOrigin, enterCode } = environment();
    if (!browser) return t.skip('no chromium found');
    const code = '910000000008'; await hub.issue(code);
    const context = await browser.newContext(), page = await context.newPage();
    hub.projects = ['/home/web/repo', '/home/web/Repo', '/home/web/repo'].map(path => ({ machine: 'm_local', path, name: path.split('/').at(-1), git: true, addedAt: 1 }));
    try {
      await page.goto(webOrigin); await enterCode(page, code);
      await page.getByRole('button', { name: 'No project', exact: true }).click();
      const upper = page.getByRole('menuitem').and(page.locator('[title="/home/web/Repo"]'));
      const lower = page.getByRole('menuitem').and(page.locator('[title="/home/web/repo"]'));
      await upper.waitFor();
      assert.equal(await lower.count(), 1);
      assert.equal(await upper.count(), 1);
      await upper.click();
      await page.getByRole('button', { name: 'Repo', exact: true }).click();
      await lower.click();
      await page.getByRole('button', { name: 'repo', exact: true }).waitFor();
    } finally { hub.projects = []; await context.close(); }
  });

  test('adding a folder updates the already mounted Home composer project picker', async t => {
    const { browser, hub, webOrigin, enterCode, waitUntil } = environment();
    if (!browser) return t.skip('no chromium found');
    const code = '910000000006'; await hub.issue(code);
    const context = await browser.newContext(), page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    hub.projects = [];
    try {
      await page.goto(webOrigin); await enterCode(page, code);
      const picker = page.getByRole('button', { name: 'No project', exact: true });
      await picker.click();
      assert.equal(await page.getByRole('menuitem').filter({ hasText: '/home/web/repo' }).count(), 0);
      await page.keyboard.press('Escape');
      const composer = page.locator('textarea').first(); await composer.fill('Keep this mounted draft');
      await page.getByRole('button', { name: 'Add project folder' }).click();
      await page.getByRole('button', { name: /web-test/ }).click();
      await page.getByRole('option', { name: 'denied' }).click();
      await page.getByRole('button', { name: 'Add project', exact: true }).click();
      await waitUntil(() => hub.projectAdds.length > 0);
      assert.equal(hub.projectAdds.at(-1).path, '/home/web/denied');
      const alert = page.getByRole('dialog').getByRole('alert');
      await alert.waitFor({ timeout: 5000 });
      assert.match(await alert.textContent({ timeout: 5000 }), /permission denied/);
      assert.equal(hub.projects.length, 0);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Add project folder' }).click();
      await page.getByRole('button', { name: /web-test/ }).click();
      await page.getByRole('option', { name: 'repo', exact: true }).click();
      await page.getByRole('button', { name: 'Add project', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await picker.click();
      await page.getByRole('menuitem').filter({ hasText: '/home/web/repo' }).waitFor();
      assert.equal(await page.getByRole('menuitem').filter({ hasText: '/home/web/denied' }).count(), 0);
      assert.equal(await composer.inputValue(), 'Keep this mounted draft');
      assert.deepEqual(errors, []);
    } catch (error) {
      t.diagnostic(JSON.stringify({ errors, body: await page.locator('body').innerText(), adds: hub.projectAdds }));
      throw error;
    } finally { hub.projects = []; await context.close(); }
  });

  test('Show hidden keeps the browsed folder through populated, empty and failed listings', async t => {
    const { browser, hub, webOrigin, enterCode, waitUntil } = environment();
    if (!browser) return t.skip('no chromium found');
    const code = '910000000007'; await hub.issue(code);
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(webOrigin); await enterCode(page, code);
      await page.getByRole('button', { name: 'Add project folder' }).click();
      await page.getByRole('button', { name: /web-test/ }).click();
      await page.getByRole('option', { name: 'repo', exact: true }).dblclick();
      await page.getByRole('option', { name: 'child', exact: true }).waitFor();
      const hidden = page.getByRole('checkbox', { name: 'Show hidden' });
      await hidden.check();
      await page.getByRole('option', { name: '.hidden', exact: true }).waitFor();
      assert.equal(hub.browseRequests.at(-1).path, '/home/web/repo');
      assert.equal(hub.browseRequests.at(-1).hidden, true);
      await hidden.uncheck();
      await waitUntil(() => hub.browseRequests.at(-1).hidden === false);
      await page.getByRole('option', { name: '.hidden', exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('option', { name: 'child', exact: true }).dblclick();
      await page.getByText('No folders here.', { exact: true }).waitFor();
      hub.failBrowse = true;
      await hidden.check();
      await page.getByRole('alert').filter({ hasText: 'permission denied' }).waitFor();
      assert.equal(hub.browseRequests.at(-1).path, '/home/web/repo/child');
      await hidden.uncheck();
      await page.getByText('No folders here.', { exact: true }).waitFor();
      assert.equal(hub.browseRequests.at(-1).path, '/home/web/repo/child');
      assert.deepEqual(errors, []);
    } finally { hub.failBrowse = false; await context.close(); }
  });
}
