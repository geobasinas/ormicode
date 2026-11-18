import { launchApp, out } from './lib.mjs';
const { app, page } = await launchApp();
try {
  await page.waitForTimeout(1000);
  // project chip is the first chip button (folder icon) in the composer card
  const card = page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  const projectChip = card.locator('button:has-text("scratch"), button:has-text("ormicode")').first();
  await projectChip.click();
  await page.waitForTimeout(400);
  const menu = page.locator('[role="menu"]').first();
  console.log('MENU:', JSON.stringify(await menu.allInnerTexts()));
  await page.screenshot({ path: out('project-chip.png') });
} finally { await app.close(); }
