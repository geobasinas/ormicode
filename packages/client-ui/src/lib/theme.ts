/** Apply a theme's tokens as CSS variables on the root element. */
import { cssVars, builtinThemes } from '@ormicode/ui-tokens';
import type { Theme } from '@ormicode/ui-tokens';

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(cssVars(theme))) root.style.setProperty(name, value);
  root.dataset.theme = theme.name;
}

export function themeByName(name: string): Theme {
  return builtinThemes.find(t => t.name === name) ?? builtinThemes[0]!;
}
