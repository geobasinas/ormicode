/** Type tokens — font stacks and the size scale. */

export interface TypeTokens {
  'font.ui': string; 'font.mono': string; 'font.serif': string;
  'text.xs': string; 'text.sm': string; 'text.md': string; 'text.lg': string; 'text.xl': string; 'text.2xl': string;
  'leading.tight': string; 'leading.normal': string; 'leading.loose': string;
}

export const typeScale: TypeTokens = {
  'font.ui': '"Inter Variable", Inter, system-ui, sans-serif',
  'font.mono': '"JetBrains Mono", ui-monospace, monospace',
  'font.serif': 'Georgia, serif',
  'text.xs': '11px', 'text.sm': '12.5px', 'text.md': '14px', 'text.lg': '17px', 'text.xl': '21px', 'text.2xl': '26px',
  'leading.tight': '1.25', 'leading.normal': '1.45', 'leading.loose': '1.65',
};
