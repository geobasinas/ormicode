/** Apply a theme's tokens on the document root.
 * The palette is driven by the persisted theme name: `data-theme` and a
 * `light` or `dark` class, which CSS variables and Tailwind `dark:` follow.
 * `color-scheme: only …` keeps Chromium from re-darkening a light theme. */
import { cssVars, builtinThemes } from '@ormicode/ui-tokens';
import type { Theme } from '@ormicode/ui-tokens';

const BUILTIN = new Set(['light', 'dark']);

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(cssVars(theme))) root.style.setProperty(name, value);
  root.dataset.theme = theme.name;
  root.classList.remove('light', 'dark');
  if (BUILTIN.has(theme.name)) root.classList.add(theme.name);
  root.style.colorScheme = theme.name === 'light' ? 'only light' : theme.name === 'dark' ? 'only dark' : 'light dark';
}

export function themeByName(name: string): Theme {
  return builtinThemes.find(t => t.name === name) ?? builtinThemes[0]!;
}
