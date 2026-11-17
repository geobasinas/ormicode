/** Colour tokens — semantic names only; the app decides where they go. */

export interface ColorTokens {
  'bg.window': string; 'bg.main': string; 'bg.card': string; 'bg.raised': string; 'bg.inset': string;
  'line.card': string; 'line.divider': string; 'line.pane': string;
  'text.title': string; 'text.active': string; 'text.label': string; 'text.secondary': string; 'text.hint': string;
  'accent.mint': string; 'accent.amber': string; 'accent.red': string;
  'tint.mint': string; 'tint.amber': string; 'tint.red': string;
  'text.onAccent': string;
}

/** The built-in `dark` theme — the reference palette from the designs. */
export const dark: ColorTokens = {
  'bg.window': '#101010', 'bg.main': '#1B1B1B', 'bg.card': '#202020', 'bg.raised': '#2A2A2A', 'bg.inset': '#171717',
  'line.card': '#2E2E2E', 'line.divider': '#262626', 'line.pane': '#222222',
  'text.title': '#F2F2F2', 'text.active': '#FAFAFA', 'text.label': '#B7B7B7', 'text.secondary': '#909090', 'text.hint': '#878787',
  'accent.mint': '#9ACBAF', 'accent.amber': '#D9B878', 'accent.red': '#D69C98',
  'tint.mint': '#2A332D', 'tint.amber': '#2B2518', 'tint.red': '#2A1D1D',
  'text.onAccent': '#181818',
};

/** Built-in `light` theme — same semantic names, light values. */
export const light: ColorTokens = {
  'bg.window': '#E7E7E7', 'bg.main': '#F2F2F2', 'bg.card': '#FAFAFA', 'bg.raised': '#FFFFFF', 'bg.inset': '#D2D2D2',
  'line.card': '#CBCBCB', 'line.divider': '#D2D2D2', 'line.pane': '#C7C7C7',
  'text.title': '#1B1B1B', 'text.active': '#101010', 'text.label': '#353535', 'text.secondary': '#4A4A4A', 'text.hint': '#6A6E76',
  'accent.mint': '#7FB69D', 'accent.amber': '#D9B878', 'accent.red': '#D69C98',
  'tint.mint': '#BFE0CD', 'tint.amber': '#F0E4C8', 'tint.red': '#F0D9D6',
  'text.onAccent': '#181818',
};
