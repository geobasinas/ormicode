/** Colour tokens — semantic names only; the app decides where they go. */

export interface ColorTokens {
  'bg.window': string; 'bg.main': string; 'bg.card': string; 'bg.raised': string; 'bg.inset': string; 'bg.chip': string; 'bg.hover': string; 'bg.selected': string; 'bg.badge': string; 'bg.scrim': string;
  'line.card': string; 'line.divider': string; 'line.pane': string; 'line.subtle': string; 'line.mint': string; 'line.amber': string; 'line.red': string;
  'text.title': string; 'text.active': string; 'text.label': string; 'text.secondary': string; 'text.hint': string;
  'accent.mint': string; 'accent.amber': string; 'accent.red': string;
  'tint.mint': string; 'tint.amber': string; 'tint.red': string;
  'text.onAccent': string; 'shadow.color': string;
}

/** The built-in `dark` theme — the reference palette from the designs. */
export const dark: ColorTokens = {
  'bg.window': '#101010', 'bg.main': '#1B1B1B', 'bg.card': '#202020', 'bg.raised': '#2D2D2D', 'bg.inset': '#171717', 'bg.chip': '#282828', 'bg.hover': '#242424', 'bg.selected': '#2A2A2A', 'bg.badge': '#C7C7C7', 'bg.scrim': '#101010B8',
  'line.card': '#3A3A3A', 'line.divider': '#313131', 'line.pane': '#2C2C2C', 'line.subtle': '#262626',
  'line.mint': '#7DDBA859', 'line.amber': '#F2C25E59', 'line.red': '#F48C8459',
  'text.title': '#F2F2F2', 'text.active': '#FAFAFA', 'text.label': '#D0D0D0', 'text.secondary': '#ADADAD', 'text.hint': '#9A9A9A',
  'accent.mint': '#7DDBA8', 'accent.amber': '#F2C25E', 'accent.red': '#F48C84',
  'tint.mint': '#1F3A2A', 'tint.amber': '#3A2E12', 'tint.red': '#3D201E',
  'text.onAccent': '#181818', 'shadow.color': '#1010103D',
};

/** Built-in `light` theme — same semantic names, light values. */
export const light: ColorTokens = {
  'bg.window': '#E7E7E7', 'bg.main': '#F2F2F2', 'bg.card': '#FAFAFA', 'bg.raised': '#FFFFFF', 'bg.inset': '#EBEBEB', 'bg.chip': '#E0E0E0', 'bg.hover': '#E8E8E8', 'bg.selected': '#E2E2E2', 'bg.badge': '#4A4A4A', 'bg.scrim': '#1B1B1B7A',
  'line.card': '#D3D3D3', 'line.divider': '#DADADA', 'line.pane': '#D6D6D6', 'line.subtle': '#E6E6E6',
  'line.mint': '#1C754759', 'line.amber': '#8A5A0059', 'line.red': '#B3352B59',
  'text.title': '#1B1B1B', 'text.active': '#101010', 'text.label': '#242424', 'text.secondary': '#3A3A3A', 'text.hint': '#585858',
  'accent.mint': '#1C7547', 'accent.amber': '#8A5A00', 'accent.red': '#B3352B',
  'tint.mint': '#D2EEDD', 'tint.amber': '#F6E6C2', 'tint.red': '#F7D9D5',
  'text.onAccent': '#FAFAFA', 'shadow.color': '#1B1B1B2E',
};
