/** Screenshots the built desktop app at mockup size into .ui-out/.
 *  node scripts/ui/shot.mjs [home] [session] [--scale 2] [--clip x,y,w,h] [--hover "css selector"] */
import { args, launchApp, openFirstSession, out } from './lib.mjs';

const { flags, rest } = args();
const screens = rest.length ? rest : ['home', 'session'];
const scale = Number(flags.scale ?? 1);
const clip = flags.clip ? (([x, y, width, height]) => ({ x, y, width, height }))(String(flags.clip).split(',').map(Number)) : undefined;
const { app, page } = await launchApp({ scale });
try {
  for (const s of screens) {
    if (s === 'session' && !(await openFirstSession(page))) { console.log('no sessions to open; skipped session'); continue; }
    if (flags.hover) { await page.hover(String(flags.hover)); await page.waitForTimeout(300); }
    const file = out(`${s}${clip ? '-clip' : ''}.png`);
    await page.screenshot({ path: file, clip });
    console.log(file);
  }
} finally { await app.close(); }
