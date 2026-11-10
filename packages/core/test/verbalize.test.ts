import { describe, expect, it } from 'vitest';
import { diffFacts, parseModel, verbalizationGenerator, type Fact, type OptionValues, type TextOutput } from '../src/index.js';
import { checkOutput } from './check.js';
import { allCases, exampleCases, modelOf } from './special.js';

const run = (model: ReturnType<typeof modelOf>, options: OptionValues): TextOutput => {
  const out = verbalizationGenerator.generate(model, options);
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

const optionSets: OptionValues[] = [
  { language: 'en', showIdentifiers: false },
  { language: 'en', showIdentifiers: true },
  { language: 'de', showIdentifiers: false },
  { language: 'de', showIdentifiers: true },
];

const QUOTED = new Set(['label', 'identifier', 'sequenceFlowName', 'condition']);
const RAW = new Set(['eventType', 'arcWeight', 'initialMarking', 'finalMarking']);

/** The literal value of a value-bearing fact must stand in the sentence that is mapped to it. */
function valueIsStated(f: Fact, spanText: string): boolean {
  if (QUOTED.has(f.category)) return spanText.includes(JSON.stringify(f.value));
  if (f.category === 'annotation' && f.aspect === 'text') return spanText.includes(JSON.stringify(f.value));
  if (RAW.has(f.category)) return spanText.includes(f.value);
  return true;
}

describe('verbalization (FA-25)', () => {
  for (const options of optionSets) {
    describe(JSON.stringify(options), () => {
      for (const c of allCases) {
        it(c.name, () => {
          const model = modelOf(c);
          const out = run(model, options);
          checkOutput(out, new Set(model.facts.map((f) => f.id)));
          const byId = new Map(out.facts.map((f) => [f.id, f]));
          for (const span of out.spans) {
            const stretch = out.text.slice(span.start, span.end);
            expect(stretch.endsWith('.')).toBe(true);
            for (const id of span.factIds) {
              const f = byId.get(id);
              expect(f && valueIsStated(f, stretch), `${id} in "${stretch}"`).toBe(true);
            }
          }
          const hasIdentifiers = out.facts.some((f) => f.category === 'identifier');
          if (options.showIdentifiers === false) expect(hasIdentifiers).toBe(false);
          // Determinism (R-5).
          expect(run(modelOf(c), options)).toEqual(out);
        });
      }
    });
  }

  it('tells the languages apart and keeps the same carried facts in both', () => {
    for (const c of exampleCases) {
      const model = modelOf(c);
      const en = run(model, { language: 'en', showIdentifiers: true });
      const de = run(model, { language: 'de', showIdentifiers: true });
      expect(en.text).toContain('There is ');
      expect(de.text).toContain('Es gibt ');
      expect(diffFacts(en.facts, de.facts)).toEqual([]);
      expect(diffFacts(de.facts, en.facts)).toEqual([]);
    }
  });

  it('states every Petri net fact except layout and net/page facts', () => {
    for (const c of exampleCases.filter((x) => x.formalism === 'pnml')) {
      const model = modelOf(c);
      const out = run(model, { language: 'en', showIdentifiers: true });
      const missing = diffFacts(model.facts, out.facts).filter((f) => f.category !== 'layout' && !['net', 'page'].includes(model.nodes.find((n) => n.id === f.subject)?.type ?? ''));
      expect(missing, c.name).toEqual([]);
    }
  });

  it('introduces an alias for unnamed or duplicate names and uses it afterwards', () => {
    const out = run(
      parseModel(`<?xml version="1.0"?><pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="pg">
        <place id="p1"><name><text>dup</text></name></place><place id="p2"><name><text>dup</text></name></place><transition id="t"/>
        <arc id="a1" source="p1" target="t"/><arc id="a2" source="t" target="p2"><inscription><text>3</text></inscription></arc></page></net></pnml>`),
      { language: 'en', showIdentifiers: false },
    );
    expect(out.text).toContain('There is a place named "dup", referred to below as place 1.');
    expect(out.text).toContain('its outgoing arcs lead to place 2 (weight 3).');
    expect(out.text).toContain('There is a transition without a name, referred to below as transition 1.');
  });

  it('does not mention an element id when identifiers are off, and does when they are on', () => {
    const model = modelOf(exampleCases.filter((x) => x.formalism === 'pnml')[0] as (typeof exampleCases)[number]);
    const id = model.nodes.find((n) => n.type === 'place' && n.idExplicit)?.id ?? '';
    expect(run(model, { language: 'en', showIdentifiers: false }).text).not.toContain(`identifier ${JSON.stringify(id)}`);
    expect(run(model, { language: 'en', showIdentifiers: true }).text).toContain(`identifier ${JSON.stringify(id)}`);
  });
});
