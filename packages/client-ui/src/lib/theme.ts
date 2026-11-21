/** Apply a theme's tokens on the document root.
 * The palette is driven by the persisted theme name: `data-theme` and a
 * `light` or `dark` class, which CSS variables and Tailwind `dark:` follow.
 * `color-scheme: only …` keeps Chromium from re-darkening a light theme. */
import { useLayoutEffect, useState } from 'react';
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

/** 'system' follows the OS; anything else is used as-is. */
export function resolveThemeName(name: string): string {
  if (name !== 'system') return name;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyNamedTheme(name: string, root: HTMLElement = document.documentElement): void {
  applyTheme(themeByName(resolveThemeName(name)), root);
}

/** Applies the named theme (resolving 'system') and keeps it in sync with the OS while 'system' is selected. */
export function useAppliedTheme(theme: string, desktop?: { setTheme?(t: 'light' | 'dark' | 'system'): void }): void {
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    applyNamedTheme(theme);
    const resolved = resolveThemeName(theme);
    if (resolved === 'light' || resolved === 'dark') desktop?.setTheme?.(theme === 'system' ? 'system' : resolved as 'light' | 'dark');
    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => setTick(t => t + 1);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [desktop, theme, tick]);
}
