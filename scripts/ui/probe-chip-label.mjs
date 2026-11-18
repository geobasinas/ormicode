import { launchApp, out } from './lib.mjs';
const { app, page } = await launchApp();
try {
  await page.waitForTimeout(1200);
  const card = page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  const chipBtn = card.locator('button').filter({ hasText: /claude|codex|grok|opencode|pi|vibe|fake/ }).first();
  const menu = (i) => page.locator('[role="menu"]').nth(i);
  await chipBtn.click(); await page.waitForTimeout(300);
  console.log('MENU0:', JSON.stringify((await menu(0).allInnerTexts()).map(t => t.slice(0, 120))));
  const modelTrigger = menu(0).locator('[role="menuitem"]', { hasText: 'Model' }).first();
  console.log('modelTrigger count:', await modelTrigger.count());
  await modelTrigger.hover(); await page.waitForTimeout(500);
  console.log('menus open:', await page.locator('[role="menu"]').count());
  await menu(1).locator('[role="menuitem"]', { hasText: 'Sonnet 4.6' }).first().click();
  await page.waitForTimeout(300);
  await chipBtn.click(); await page.waitForTimeout(300);
  await menu(0).locator('[role="menuitem"]', { hasText: 'Effort' }).first().hover();
  await page.waitForTimeout(400);
  await menu(1).getByRole('menuitem', { name: 'high', exact: true }).click();
  await page.waitForTimeout(300);
  await card.screenshot({ path: out('chip-label.png') });
  console.log('CHIP:', await chipBtn.innerText());
} catch (e) { await page.screenshot({ path: out('chip-fail.png') }); throw e; }
finally { await app.close(); }
