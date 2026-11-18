import { launchApp, out } from './lib.mjs';
const { app, page } = await launchApp();
try {
  await page.waitForTimeout(1200);
  const card = page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  // pick the ormicode project from the project chip
  await card.locator('button:has-text("scratch")').first().click();
  await page.waitForTimeout(400);
  await page.locator('[role="menu"] [role="menuitem"]:has-text("ormicode")').first().click();
  await page.waitForTimeout(900);
  console.log('CHIPS:', JSON.stringify(await card.locator('button').allInnerTexts()));
  // open the git chip (shows current branch 'main')
  const gitChip = card.locator('button:has-text("main"), button:has-text("current")').first();
  if (await gitChip.count()) {
    await gitChip.click();
    await page.waitForTimeout(400);
    console.log('GIT MENU:', JSON.stringify(await page.locator('[role="menu"]').first().allInnerTexts()));
    await page.screenshot({ path: out('git-chip.png') });
  } else console.log('NO GIT CHIP');
} finally { await app.close(); }
