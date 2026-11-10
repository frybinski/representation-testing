import { describe, expect, it } from 'vitest';
import { modelOf, specialCases } from './special.js';

describe('special fixtures are readable and exercise what they claim', () => {
  for (const c of specialCases) {
    it(c.name, () => {
      const m = modelOf(c);
      expect(m.formalism).toBe(c.formalism);
      expect(m.facts.length).toBeGreaterThan(8);
    });
  }

  it('contain anonymous nodes, anonymous edges, parallel edges and several final markings', () => {
    const b = modelOf(specialCases[2] as (typeof specialCases)[number]);
    expect(b.nodes.some((n) => !n.idExplicit)).toBe(true);
    expect(b.edges.some((e) => e.id === undefined)).toBe(true);
    expect(b.edges.some((e) => e.key.split(',').length === 3)).toBe(true);
    const p = modelOf(specialCases[5] as (typeof specialCases)[number]);
    expect(p.facts.filter((f) => f.category === 'finalMarking').map((f) => f.aspect)).toContain('m3'.replace('3', '2'));
    expect(p.facts.some((f) => f.category === 'silentTransition')).toBe(true);
  });
});
