import { describe, expect, it } from 'vitest';
import { contrast } from '../src/contrast.ts';
import { SCHEMES, TEXT_PAIRS, UI_PAIRS, type ColourName, type SchemeName } from '../src/tokens.ts';

// NF-04: WCAG AA. 4.5 for text (1.4.3), 3 for borders, focus ring and symbols (1.4.11).
const AA_TEXT = 4.5;
const AA_UI = 3;

describe('contrast ratios of the design tokens (NF-04)', () => {
  it('computes known values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  for (const scheme of Object.keys(SCHEMES) as SchemeName[]) {
    const palette = SCHEMES[scheme];
    const check = (pairs: Readonly<Record<string, readonly ColourName[]>>, min: number): void => {
      for (const [fg, surfaces] of Object.entries(pairs)) {
        for (const bg of surfaces) {
          it(`${scheme}: ${fg} on ${bg} is at least ${min}`, () => {
            expect(contrast(palette[fg as ColourName], palette[bg])).toBeGreaterThanOrEqual(min);
          });
        }
      }
    };
    check(TEXT_PAIRS, AA_TEXT);
    check(UI_PAIRS, AA_UI);
  }

  it('lists only colours that exist', () => {
    for (const pairs of [TEXT_PAIRS, UI_PAIRS]) {
      for (const [fg, surfaces] of Object.entries(pairs)) {
        expect(fg in SCHEMES.light).toBe(true);
        for (const bg of surfaces) expect(bg in SCHEMES.light).toBe(true);
      }
    }
  });
});
