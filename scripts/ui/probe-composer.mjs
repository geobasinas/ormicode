import { launchApp, out } from './lib.mjs';
const { app, page } = await launchApp();
try {
  await page.waitForTimeout(800);
  // open the claude/sdk session "Hello tell me a joke" (first of that title)
  const row = page.locator('button:has-text("Hello tell me a joke")').first();
  await row.click(); await page.waitForTimeout(1800);
  const ta = page.locator('textarea').first();
  const card = ta.locator('xpath=ancestor::div[1]');
  const buttons = card.locator('button, label');
  const n = await buttons.count();
  console.log('session composer buttons:', n);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const txt = (await b.innerText().catch(() => '')).replace(/\n/g, ' ').trim();
    await b.click().catch(() => {});
    await page.waitForTimeout(500);
    const menus = page.locator('[role="menu"]');
    if (await menus.count()) {
      const items = await menus.first().allInnerTexts();
      console.log(`CHIP[${i}] "${txt}":`, JSON.stringify(items).slice(0, 1200));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    } else console.log(`CHIP[${i}] "${txt}": no menu`);
  }
  await page.screenshot({ path: out('probe-session.png') });
} finally { await app.close(); }
