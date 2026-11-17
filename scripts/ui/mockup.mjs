/** Dumps text and shape geometry from a mockup SVG in designs/desktop.
 *  node scripts/ui/mockup.mjs <screen> [--find <text>] [--tsv] */
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { args, launchSvgBrowser, mockupPath, MOCKUP_SIZE, out, round } from './lib.mjs';

export async function dumpMockup(name) {
  const browser = await launchSvgBrowser();
  const page = await browser.newPage({ viewport: MOCKUP_SIZE });
  await page.goto(pathToFileURL(mockupPath(name)).href);
  const rows = await page.evaluate(() => {
    const r = [];
    for (const t of document.querySelectorAll('text')) {
      const b = t.getBoundingClientRect();
      r.push({ kind: 'text', x: b.x, y: b.y, w: b.width, h: b.height, size: t.getAttribute('font-size'), weight: t.getAttribute('font-weight'), fill: t.getAttribute('fill'), text: t.textContent.trim() });
    }
    for (const e of document.querySelectorAll('path,rect')) {
      const b = e.getBoundingClientRect(); const fill = e.getAttribute('fill');
      if (b.width > 20 && b.height > 12 && fill && fill !== 'none') r.push({ kind: 'shape', x: b.x, y: b.y, w: b.width, h: b.height, fill });
    }
    return r;
  });
  await browser.close();
  return rows.map(r => ({ ...r, x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { flags, rest } = args();
  if (!rest[0]) { console.error('usage: mockup.mjs <screen> [--find text] [--tsv]  (e.g. home, notes, "git")'); process.exit(2); }
  let rows = await dumpMockup(rest[0]);
  if (flags.find) rows = rows.filter(r => r.text?.toLowerCase().includes(String(flags.find).toLowerCase()));
  const line = r => r.kind === 'text'
    ? `T\t${r.x}\t${r.y}\t${r.w}\t${r.h}\t${r.size}\t${r.weight}\t${r.fill}\t${r.text.slice(0, 48)}`
    : `S\t${r.x}\t${r.y}\t${r.w}\t${r.h}\t${r.fill}`;
  const lines = rows.map(line);
  if (flags.tsv) { const f = out(`${rest[0]}-mockup.tsv`); writeFileSync(f, lines.join('\n')); console.log(`${lines.length} rows -> ${f}`); }
  else console.log('kind\tx\ty\tw\th\tsize\tweight\tfill\ttext\n' + lines.join('\n'));
}
