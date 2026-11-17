import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function checkLayout(base, layout) {
  const errors = [];
  for (const [group, names] of Object.entries(layout)) {
    for (const name of names) {
      const path = join(base, group, name);
      try {
        if (!statSync(path).isDirectory()) errors.push(`${path} is not a directory`);
      } catch {
        errors.push(`Missing ${path}`);
      }
    }
  }
  return errors;
}

function checkSourceSize(base, group) {
  const errors = [];
  const skip = new Set(['.wrangler', 'dist', 'out', 'node_modules', '.turbo', 'coverage']);
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) { if (!skip.has(entry.name)) visit(child); continue; }
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const lines = readFileSync(child, 'utf8').split(/\r?\n/).length;
        if (lines > 400) errors.push(`${child}: ${lines} lines exceeds 400`);
      }
    }
  }
  visit(join(base, group));
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const layout = JSON.parse(readFileSync(join(root, 'scripts/layout.json'), 'utf8'));
  const errors = [...checkLayout(root, layout), ...checkSourceSize(root, 'apps'), ...checkSourceSize(root, 'packages')];
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Scaffold layout and source file sizes pass.');
  }
}
