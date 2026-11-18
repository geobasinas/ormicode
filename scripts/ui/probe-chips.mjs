import { launchApp, out } from './lib.mjs';
const { app, page } = await launchApp();
try {
  await page.waitForTimeout(1200);
  const card = page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  console.log('CHIPS:', JSON.stringify(await card.locator('button').allInnerTexts()));
  // agent chip: the button whose text starts with a vendor name (contains 'claude' or 'sdk'/'cli')
  const agentChip = card.locator('button').filter({ hasText: /claude|codex|grok|opencode|pi|vibe|fake/ }).first();
  await agentChip.click();
  await page.waitForTimeout(400);
  const menus = page.locator('[role="menu"]');
  console.log('AGENT MENU:', JSON.stringify(await menus.first().allInnerTexts()));
  // open the Model submenu
  const modelTrigger = menus.first().locator('[role="menuitem"]:has-text("Model"), [role="menuitemcheckbox"]:has-text("Model")').first();
  await modelTrigger.hover();
  await page.waitForTimeout(400);
  const all = await page.locator('[role="menu"]').allInnerTexts();
  console.log('MENUS NOW:', all.length, JSON.stringify(all.map(t => t.slice(0, 300))));
  await page.screenshot({ path: out('agent-chip.png') });
} finally { await app.close(); }
