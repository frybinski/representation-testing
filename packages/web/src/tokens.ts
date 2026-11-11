/**
 * Design tokens (UI-06): every colour, font size and spacing value of the interface, in one place.
 * `tokensCss()` turns them into CSS custom properties; styles.css refers to those and to nothing else.
 * The contrast test (test/contrast.test.ts) checks every pair listed in `TEXT_PAIRS` and `UI_PAIRS` against WCAG AA (NF-04).
 */

/** Spacing scale in pixels, multiples of 4 (UI-05). The CSS variable of the value 12 is `--space-12`. */
export const SPACING = [4, 8, 12, 16, 24, 32, 48] as const;

/** At most four font sizes in pixels (UI-05). */
export const FONT_SIZE = {
  small: 12, // figures line, matrix header, line numbers
  code: 13, // text representations
  body: 14, // interface text
  title: 18, // name of the tool
} as const;

export const FONT_FAMILY = {
  ui: '"Inter Variable", system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
} as const;

export const RADIUS = { control: 4, field: 8 } as const;

/** Pixel measures the layout depends on; multiples of 4 like the spacing. */
export const SIZE = {
  header: 48,
  bar: 48,
  row: 28,
  line: 20,
  icon: 16,
  target: 32,
  /** Width below which the two views become tabs (UI-09). Also used by the CSS media query in styles.css. */
  narrow: 720,
} as const;

export const COLOUR_NAMES = [
  'bg', // page
  'surface', // views and panels
  'sunken', // matrix header, hover
  'accentSoft', // selection tint
  'mark', // background of the ranges of the selected element in a text view (FA-61)
  'text',
  'textMuted',
  'accent',
  'line', // hairlines between zones; decorative, exempt from contrast rules
  'control', // borders of form controls and symbols that carry meaning
  'completeText',
  'completeBg',
  'partialText',
  'partialBg',
  'noneText',
  'noneBg',
  'synName', // syntax highlighting in the text views (tag names, keywords)
  'synAttr', // attribute names, JSON keys, Mermaid arrows
  'synString', // quoted strings
  'synComment',
  'diagramInk', // lines, shapes and text of the diagram (the SVG of the core draws in #333333 on white)
] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];
export type Palette = Record<ColourName, string>;

export const LIGHT: Palette = {
  bg: '#FAFAF9',
  surface: '#FFFFFF',
  sunken: '#F2F2F0',
  accentSoft: '#ECEEFC',
  mark: '#DDE2FC',
  text: '#1C1C1F',
  textMuted: '#595960',
  accent: '#4338CA',
  line: '#E4E4E0',
  control: '#85858D',
  completeText: '#14612F',
  completeBg: '#E4F3E9',
  partialText: '#7A4300',
  partialBg: '#FBF0D9',
  noneText: '#9B1C1C',
  noneBg: '#FBE9E9',
  synName: '#6B2FA0',
  synAttr: '#0B6470',
  synString: '#8A3B12',
  synComment: '#62626A',
  diagramInk: '#333333',
};

export const DARK: Palette = {
  bg: '#111113',
  surface: '#18181B',
  sunken: '#212125',
  accentSoft: '#25264A',
  mark: '#34376B',
  text: '#EDEDEF',
  textMuted: '#A3A3AB',
  accent: '#A5B0FF',
  line: '#2C2C31',
  control: '#7C7C86',
  completeText: '#8FE3A9',
  completeBg: '#17321F',
  partialText: '#F2C766',
  partialBg: '#372A0B',
  noneText: '#FF9E9E',
  noneBg: '#3A1818',
  synName: '#D2A8FF',
  synAttr: '#7FD6DE',
  synString: '#F0B28A',
  synComment: '#AAAAB3',
  diagramInk: '#D4D4D8',
};

export const SCHEMES = { light: LIGHT, dark: DARK } as const;
export type SchemeName = keyof typeof SCHEMES;

/** Text colours and the surfaces they may be set on; contrast ratio at least 4.5 (WCAG 1.4.3, AA). */
export const TEXT_PAIRS: Readonly<Record<string, readonly ColourName[]>> = {
  text: ['bg', 'surface', 'sunken', 'accentSoft', 'mark'],
  textMuted: ['bg', 'surface', 'sunken'],
  accent: ['bg', 'surface', 'sunken', 'accentSoft'],
  completeText: ['completeBg', 'surface'],
  partialText: ['partialBg', 'surface'],
  noneText: ['noneBg', 'surface'],
  synName: ['surface', 'sunken', 'accentSoft', 'mark'],
  synAttr: ['surface', 'sunken', 'accentSoft', 'mark'],
  synString: ['surface', 'sunken', 'accentSoft', 'mark'],
  synComment: ['surface', 'sunken', 'accentSoft', 'mark'],
  diagramInk: ['surface', 'sunken'],
};

/** Borders, focus ring and symbols against the surfaces they touch; contrast ratio at least 3 (WCAG 1.4.11, AA). */
export const UI_PAIRS: Readonly<Record<string, readonly ColourName[]>> = {
  control: ['bg', 'surface', 'sunken'],
  accent: ['bg', 'surface', 'sunken', 'mark'], // focus ring and selected-tab marker
};

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const declarations = (p: Palette, scheme: SchemeName): string =>
  `color-scheme: ${scheme};` + (Object.keys(p) as ColourName[]).map((k) => `--color-${kebab(k)}: ${p[k]};`).join('');

/**
 * CSS for the custom properties. The system setting decides unless the user has chosen a scheme (`data-scheme` on the root element).
 * The dark block appears twice because CSS has no way to share it between a media query and an attribute selector.
 */
export function tokensCss(): string {
  const fixed =
    SPACING.map((n) => `--space-${n}: ${n}px;`).join('') +
    (Object.entries(FONT_SIZE) as [string, number][]).map(([k, v]) => `--font-${k}: ${v}px;`).join('') +
    `--font-ui: ${FONT_FAMILY.ui};--font-mono: ${FONT_FAMILY.mono};` +
    (Object.entries(RADIUS) as [string, number][]).map(([k, v]) => `--radius-${k}: ${v}px;`).join('') +
    (Object.entries(SIZE) as [string, number][]).map(([k, v]) => `--size-${k}: ${v}px;`).join('');
  return [
    `:root { ${fixed}${declarations(LIGHT, 'light')} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-scheme="light"]) { ${declarations(DARK, 'dark')} } }`,
    `:root[data-scheme="dark"] { ${declarations(DARK, 'dark')} }`,
  ].join('\n');
}

/**
 * The colours the core writes into the SVG of the diagram (docs/diagram.md: a grey scale as presentation attributes, so that a saved file
 * renders anywhere). The page maps them to the tokens so that the diagram follows the colour scheme; the exported file is not changed.
 */
export const DIAGRAM_SOURCE_COLOURS: Readonly<Record<string, 'ink' | 'paper' | 'band'>> = {
  '#333333': 'ink',
  '#222222': 'ink',
  '#ffffff': 'paper',
  '#f6f6f6': 'band',
};
