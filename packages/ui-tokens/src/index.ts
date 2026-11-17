/**
 * Theme tokens for every ormicode client. Semantic names only — a theme
 * file (JSON at ~/.ormicode/themes/<name>.json) supplies the same keys and
 * the app maps them to CSS variables. `dark` and `light` are built in and
 * serve as the reference examples.
 */
export { dark, light } from './color.ts';
export type { ColorTokens } from './color.ts';
export { typeScale } from './type.ts';
export type { TypeTokens } from './type.ts';
export { space } from './space.ts';
export type { SpaceTokens } from './space.ts';
export { motion } from './motion.ts';
export type { MotionTokens } from './motion.ts';

import { dark, light } from './color.ts';
import type { ColorTokens } from './color.ts';
import { typeScale } from './type.ts';
import { space } from './space.ts';
import { motion } from './motion.ts';

export interface Theme { name: string; colors: ColorTokens }
export const builtinThemes: Theme[] = [{ name: 'dark', colors: dark }, { name: 'light', colors: light }];

/** Flat token name → CSS variable (`bg.card` → `--bg-card`). */
export function cssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const all = { ...theme.colors, ...typeScale, ...space, ...motion };
  for (const [k, v] of Object.entries(all)) vars[`--${k.replace(/\./g, '-')}`] = v;
  return vars;
}
