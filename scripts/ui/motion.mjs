/** Checks window maximize pacing and the minimize/restore round-trip.
 *  node scripts/ui/motion.mjs */
import { launchApp } from './lib.mjs';

const { app, page } = await launchApp();
const info = () => app.evaluate(({ BrowserWindow }) => {
  const b = BrowserWindow.getAllWindows()[0];
  return { minimized: b.isMinimized(), opacity: b.getOpacity(), bounds: b.getBounds() };
});
try {
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0];
    const set = b.setBounds.bind(b);
    globalThis.__t = [];
    b.setBounds = r => { globalThis.__t.push(performance.now()); set(r); };
  });
  const start = (await info()).bounds;
  await page.click('button[title="Maximize"]');
  await page.waitForTimeout(700);
  const gaps = await app.evaluate(() => globalThis.__t.slice(1).map((x, i) => Math.round(x - globalThis.__t[i])));
  const max = (await info()).bounds;
  await page.click('button[title="Maximize"]');
  await page.waitForTimeout(700);
  const back = (await info()).bounds;
  console.log('maximize frame gaps (ms):', gaps.join(','), `| worst ${Math.max(...gaps)}ms`);
  console.log('maximized:', JSON.stringify(max));
  const close = ['x', 'y', 'width', 'height'].every(k => Math.abs(back[k] - start[k]) <= 2);
  console.log('start:', JSON.stringify(start), 'restored:', JSON.stringify(back), close ? 'ok' : 'MISMATCH');
  if (!close) process.exitCode = 1;
  await page.click('button[title="Minimize"]');
  await page.waitForTimeout(800);
  console.log('after minimize:', JSON.stringify(await info()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await page.waitForTimeout(700);
  const r = await info();
  console.log('after restore:', JSON.stringify(r));
  if (r.minimized || r.opacity < 1) process.exitCode = 1;
} finally {
  await app.close();
}
