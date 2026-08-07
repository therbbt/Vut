export interface Palette {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  colors: {
    bg: string;
    panel: string;
    panel2: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
  };
}

// Catppuccin's own layering convention - crust < mantle < base < surface0 <
// surface1 < surface2 - mapped onto our three-tier bg/panel/panel-2 system as
// mantle/base/surface0 respectively, which produces the right elevation
// direction for both the dark flavors (panel lighter than bg) and Latte
// (panel brighter than bg, panel-2 more muted).
export const PALETTES: Palette[] = [
  {
    id: 'vut-light',
    name: 'Light',
    mode: 'light',
    colors: {
      bg: '#faf8f4',
      panel: '#fefdfb',
      panel2: '#f0ece4',
      text: '#211d18',
      muted: '#6b6259',
      border: 'rgba(33, 29, 24, 0.1)',
      accent: '#2563eb',
    },
  },
  {
    id: 'vut-dark',
    name: 'Dark',
    mode: 'dark',
    colors: {
      bg: '#16161a',
      panel: '#1e1e22',
      panel2: '#28282d',
      text: '#ecebe7',
      muted: '#97958d',
      border: 'rgba(255, 255, 255, 0.08)',
      // Same teal-green FlashPad uses for its "global search" active state
      // (Footer.svelte's .search-scope-btn.active - #4dd0c8), not the blue
      // this palette had before.
      accent: '#4dd0c8',
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    mode: 'light',
    colors: {
      bg: '#e6e9ef',
      panel: '#eff1f5',
      panel2: '#ccd0da',
      text: '#4c4f69',
      muted: '#6c6f85',
      border: '#bcc0cc',
      accent: '#1e66f5',
    },
  },
  {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    mode: 'dark',
    colors: {
      bg: '#292c3c',
      panel: '#303446',
      panel2: '#414559',
      text: '#c6d0f5',
      muted: '#a5adce',
      border: '#51576d',
      accent: '#8caaee',
    },
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    mode: 'dark',
    colors: {
      bg: '#1e2030',
      panel: '#24273a',
      panel2: '#363a4f',
      text: '#cad3f5',
      muted: '#a5adcb',
      border: '#494d64',
      accent: '#8aadf4',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'dark',
    colors: {
      bg: '#181825',
      panel: '#1e1e2e',
      panel2: '#313244',
      text: '#cdd6f4',
      muted: '#a6adc8',
      border: '#45475a',
      accent: '#89b4fa',
    },
  },
];

export const DEFAULT_LIGHT_PALETTE_ID = 'vut-light';
export const DEFAULT_DARK_PALETTE_ID = 'vut-dark';

export const palettesForMode = (mode: 'light' | 'dark'): Palette[] => PALETTES.filter((p) => p.mode === mode);

export const getPalette = (id: string): Palette =>
  PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_DARK_PALETTE_ID)!;

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Applied as inline custom properties on <html> rather than through a
// stylesheet, since the active palette is a runtime choice (any of six, not
// just "light" or "dark") - CSS alone can't express that without generating
// a rule per palette. `color-scheme` (native scrollbars/form controls) stays
// on the static `data-theme` rules in each window's <style>, since that only
// ever needs to follow light/dark mode, not the specific palette.
export const applyPalette = (palette: Palette): void => {
  const root = document.documentElement.style;
  root.setProperty('--bg', palette.colors.bg);
  root.setProperty('--panel', palette.colors.panel);
  root.setProperty('--panel-2', palette.colors.panel2);
  root.setProperty('--text', palette.colors.text);
  root.setProperty('--muted', palette.colors.muted);
  root.setProperty('--border', palette.colors.border);
  root.setProperty('--accent', palette.colors.accent);
  root.setProperty('--accent-soft', hexToRgba(palette.colors.accent, 0.16));
};
