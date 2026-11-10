import { describe, expect, it } from 'vitest';
import { BPMN_FACT_CATEGORIES, PNML_FACT_CATEGORIES, buildInventory, combine, computeInventory, createDefaultRegistry, sameFacts, type TextOutput } from '../src/index.js';
import { allCases, exampleCases, modelOf } from './special.js';

const registry = createDefaultRegistry();
const firstOf = (formalism: 'bpmn' | 'pnml') => {
  const c = exampleCases.find((x) => x.formalism === formalism);
  if (!c) throw new Error('no example');
  return modelOf(c);
};

describe('inventory (FA-50, FA-51, FA-54)', () => {
  it('lists every category of the formalism, whether or not the model has facts for it', () => {
    for (const c of allCases) {
      const model = modelOf(c);
      const inv = computeInventory(registry, model);
      expect(inv.categories).toEqual([...(model.formalism === 'bpmn' ? BPMN_FACT_CATEGORIES : PNML_FACT_CATEGORIES)]);
      expect(inv.columns.map((col) => col.id)).toEqual(registry.listFor(model.formalism).map((g) => g.id));
    }
  });

  it('shows the original file as complete in every category the model has (computed, not set)', () => {
    for (const c of exampleCases) {
      const model = modelOf(c);
      const col = computeInventory(registry, model).columns.find((x) => x.id === 'original');
      expect(col).toBeDefined();
      for (const cell of col?.cells ?? []) {
        const total = model.facts.filter((f) => f.category === cell.category).length;
        expect(cell.total).toBe(total);
        expect(cell.carried).toBe(total);
        expect(cell.status).toBe(total === 0 ? 'notInModel' : 'complete');
      }
    }
  });

  it('is computed from carried facts: a column that carries less shows it', () => {
    const model = firstOf('pnml');
    const places = model.facts.filter((f) => f.category === 'place');
    expect(places.length).toBeGreaterThan(0);
    const inv = buildInventory(model, [{ id: 'x', facts: model.facts.filter((f) => f.category !== 'place') }]);
    const cell = inv.columns[0]?.cells.find((c) => c.category === 'place');
    expect(cell?.status).toBe('none');
    expect(cell?.carried).toBe(0);
    expect(cell?.missing.map((m) => m.fact.id)).toEqual(places.map((f) => f.id));
    expect(cell?.missing[0]?.element.kind).toBe('node');
  });

  it('reports partial cells with the missing facts and their elements', () => {
    const model = firstOf('bpmn');
    const labels = model.facts.filter((f) => f.category === 'label');
    const inv = buildInventory(model, [{ id: 'x', facts: model.facts.filter((f) => f.id !== labels[0]?.id) }]);
    const cell = inv.columns[0]?.cells.find((c) => c.category === 'label');
    expect(cell?.status).toBe('partial');
    expect(cell?.carried).toBe(labels.length - 1);
    expect(cell?.missing).toHaveLength(1);
    expect(cell?.missing[0]?.element.key).toBe(labels[0]?.subject);
  });

  it('resolves edge facts to edge elements', () => {
    const model = firstOf('pnml');
    const inv = buildInventory(model, [{ id: 'x', facts: [] }]);
    const arc = inv.columns[0]?.cells.find((c) => c.category === 'arc');
    expect(arc?.missing[0]?.element.kind).toBe('edge');
  });

  it('marks a category without facts as not in the model (FA-51)', () => {
    const model = modelOf(allCases.find((c) => c.formalism === 'pnml' && modelOf(c).facts.every((f) => f.category !== 'arcWeight')) as (typeof allCases)[number]);
    for (const col of computeInventory(registry, model).columns) {
      expect(col.cells.find((c) => c.category === 'arcWeight')?.status).toBe('notInModel');
    }
  });

  it('shows silent transitions as not carried by FA-21 by default, and carried with the option', () => {
    const c = exampleCases.find((x) => x.name.includes('pm4py'));
    const model = modelOf(c as NonNullable<typeof c>);
    const cellOf = (opts: Record<string, Record<string, boolean>>) =>
      computeInventory(registry, model, opts).columns.find((x) => x.id === 'original-no-layout')?.cells.find((x) => x.category === 'silentTransition');
    expect(cellOf({})?.status).toBe('none');
    expect(cellOf({ 'original-no-layout': { keepSilentMarkers: true } })?.status).toBe('complete');
  });
});

describe('combination (FA-28)', () => {
  const steps = [{ generator: 'verbalization', options: { language: 'de' } }, { generator: 'mermaid' }];
  for (const c of allCases) {
    it(`unions facts and keeps spans on the right text: ${c.name}`, () => {
      const model = modelOf(c);
      const out = combine(registry, model, steps);
      const a = registry.run('verbalization', model, { language: 'de' }) as TextOutput;
      const b = registry.run('mermaid', model) as TextOutput;
      const union = new Map([...a.facts, ...b.facts].map((f) => [f.id, f]));
      expect(sameFacts(out.facts, [...union.values()])).toBe(true);
      expect(out.facts).toHaveLength(union.size);
      const [pa, pb] = out.parts;
      expect(out.text.slice(pa?.start, pa?.end)).toBe(a.text);
      expect(out.text.slice(pb?.start, pb?.end)).toBe(b.text);
      expect(out.spans).toHaveLength(a.spans.length + b.spans.length);
      const all = [
        ...a.spans.map((s) => ({ s, single: a, at: pa?.start ?? 0 })),
        ...b.spans.map((s) => ({ s, single: b, at: pb?.start ?? 0 })),
      ];
      out.spans.forEach((span, i) => {
        const { s, single, at } = all[i] as (typeof all)[number];
        expect(span.start).toBe(s.start + at);
        expect(out.text.slice(span.start, span.end)).toBe(single.text.slice(s.start, s.end));
        expect(span.factIds).toEqual(s.factIds);
      });
    });
  }

  it('rejects an empty combination and an unknown generator', () => {
    const model = firstOf('bpmn');
    expect(() => combine(registry, model, [])).toThrow();
    expect(() => combine(registry, model, [{ generator: 'nope' }])).toThrow();
  });
});
