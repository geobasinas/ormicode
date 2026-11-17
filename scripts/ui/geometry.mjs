/** Prints live geometry (x,y,w,h) of the shell's key regions at mockup size,
 *  to compare with `mockup.mjs`. node scripts/ui/geometry.mjs [home|session] */
import { args, launchApp, openFirstSession, round } from './lib.mjs';

const { rest } = args();
const screen = rest[0] ?? 'home';
const { app, page } = await launchApp();
try {
  if (screen === 'session' && !(await openFirstSession(page))) throw new Error('no sessions to open');
  const rows = await page.evaluate(() => {
    const box = (name, el) => { const b = el?.getBoundingClientRect(); return b ? { name, x: b.x, y: b.y, w: b.width, h: b.height } : { name, missing: true }; };
    const tab = [...document.querySelectorAll('span')].find(e => e.style.position === 'relative' && e.style.cursor === 'pointer');
    return [
      box('sidebar', document.querySelector('aside')), box('tab', tab), box('card', document.querySelector('main > div:nth-child(2)')),
      box('rail', document.querySelector('main')?.nextElementSibling), box('greeting', document.querySelector('h1')),
      box('composer', document.querySelector('textarea')?.parentElement), box('search', document.querySelector('aside input')?.parentElement),
    ];
  });
  for (const r of rows) console.log(r.missing ? `${r.name}\t-` : `${r.name}\t${round(r.x)}\t${round(r.y)}\t${round(r.w)}\t${round(r.h)}`);
} finally { await app.close(); }
