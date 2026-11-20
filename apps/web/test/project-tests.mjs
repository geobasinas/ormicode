import test from 'node:test';
import assert from 'node:assert/strict';

export function registerProjectTests(environment) {
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
}
