import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Adapter packages (packages/agent-*) may import @ormicode/agent-core,
// @ormicode/protocol, vendor SDKs and general npm libs — never another
// adapter. agent-core must not import any adapter either.

// Temporary: known adapter-to-adapter imports that later steps remove one
// by one. Delete each entry when its import goes; delete the whole list
// (and the `allowlist` parameter) once it is empty.
export const TEMP_ALLOWLIST = [
  { from: 'agent-opencode-cli', to: 'agent-opencode-sdk' },
  { from: 'agent-opencode-acp', to: 'agent-opencode-sdk' },
];

const scanDirs = ['src', 'test', 'scripts'];
const skip = new Set(['node_modules', 'dist', 'out', 'coverage', '.turbo']);
const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const agentName = /^@ormicode\/(agent-[a-z0-9-]+)(?:\/|$)/;

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) { if (!skip.has(entry.name)) files.push(...sourceFiles(child)); }
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(child);
  }
  return files;
}

export function checkAgentBoundaries(base, allowlist = TEMP_ALLOWLIST) {
  const packagesDir = join(base, 'packages');
  const errors = [];
  const used = new Set();
  const allowed = (from, to) => {
    const hit = allowlist.find((entry) => entry.from === from && entry.to === to);
    if (hit) used.add(hit);
    return Boolean(hit);
  };
  const forbidden = (from, to) => to !== from && to !== 'agent-core' && !allowed(from, to);
  const names = existsSync(packagesDir)
    ? readdirSync(packagesDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('agent-')).map((e) => e.name)
    : [];

  for (const name of names) {
    const pkgDir = join(packagesDir, name);
    const pkgJson = join(pkgDir, 'package.json');
    if (existsSync(pkgJson)) {
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
      for (const field of ['dependencies', 'devDependencies']) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          const to = dep.match(agentName)?.[1];
          if (to && forbidden(name, to)) errors.push(`${relative(base, pkgJson)}: ${field} must not include ${dep} (adapters may depend only on @ormicode/agent-core and @ormicode/protocol)`);
        }
      }
    }
    for (const file of scanDirs.flatMap((dir) => sourceFiles(join(pkgDir, dir)))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(specifier)) {
        const spec = match[1];
        const line = text.slice(0, match.index).split('\n').length;
        const where = `${relative(base, file)}:${line}`;
        if (spec.startsWith('.')) {
          const target = relative(packagesDir, resolve(dirname(file), spec)).split(sep)[0];
          if (target.startsWith('agent-') && target !== name) errors.push(`${where}: relative import '${spec}' reaches into packages/${target}; import a package name instead`);
          continue;
        }
        const to = spec.match(agentName)?.[1];
        if (to && forbidden(name, to)) errors.push(`${where}: ${name} must not import '${spec}' (adapters may import only @ormicode/agent-core and @ormicode/protocol)`);
      }
    }
  }
  for (const entry of allowlist) {
    if (!used.has(entry)) errors.push(`Stale agent boundary allowlist entry ${entry.from} -> ${entry.to}; delete it from scripts/check-agent-boundaries.mjs`);
  }
  return errors;
}
