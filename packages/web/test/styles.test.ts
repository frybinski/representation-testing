import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIZE, SPACING } from '../src/tokens.ts';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('styles.css refers to the tokens (UI-05, UI-06)', () => {
  it('uses no literal colour', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it('switches to the narrow layout at the width in the tokens', () => {
    expect(css).toContain(`@media (max-width: ${SIZE.narrow - 1}px)`);
  });

  it('uses only spacing values from the scale, as variables', () => {
    const used = [...css.matchAll(/var\(--space-(\d+)\)/g)].map((m) => Number(m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const n of used) expect(SPACING as readonly number[]).toContain(n);
  });

  it('declares at most four font sizes as variables', () => {
    const sizes = new Set([...css.matchAll(/font-size:\s*var\(--font-(\w+)\)/g)].map((m) => m[1]));
    expect(sizes.size).toBeLessThanOrEqual(4);
    expect(css).not.toMatch(/font-size:\s*\d/);
  });
});
