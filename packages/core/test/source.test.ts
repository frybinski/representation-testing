import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseModel } from '../src/index.js';
import { pnml } from './helpers.js';

const example = (p: string): string => readFileSync(new URL(`../../../examples/${p}`, import.meta.url), 'utf8');

describe('source text and tool ranges', () => {
  it('keeps the exact text, including a BOM, and the loc offsets point into it', () => {
    const text = `\uFEFF${pnml('<place id="p"/><transition id="t"/>')}`;
    const m = parseModel(text);
    expect(m.source).toBe(text);
    const p = m.nodes.find((n) => n.id === 'p');
    expect(p && m.source.slice(p.loc.start, p.loc.end)).toBe('<place id="p"/>');
  });

  it('records the toolspecific elements of PNML and flags the pm4py silent marker', () => {
    const m = parseModel(example('pnml/pm4py-dialect.pnml'));
    expect(m.toolRanges).toHaveLength(2);
    expect(m.toolRanges.every((t) => t.silentMarker)).toBe(true);
    for (const t of m.toolRanges) expect(m.source.slice(t.loc.start, t.loc.end)).toMatch(/^<toolspecific[\s\S]*\/>$/);
  });

  it('does not flag other toolspecific elements, also not inside labels or on places', () => {
    const m = parseModel(
      pnml(
        '<place id="p"><toolspecific tool="ProM" activity="$invisible$"/></place>' +
          '<transition id="t"><name><text>x</text><toolspecific tool="other"/></name><toolspecific tool="other" version="1"><a/></toolspecific></transition>',
      ),
    );
    expect(m.toolRanges.map((t) => t.silentMarker)).toEqual([false, false, false]);
  });

  it('has no tool ranges for BPMN', () => {
    expect(parseModel(example('bpmn/collaboration.bpmn')).toolRanges).toEqual([]);
  });
});
