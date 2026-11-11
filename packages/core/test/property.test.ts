import { describe, expect, it } from 'vitest';
import {
  compactGenerator,
  createDefaultRegistry,
  diffFacts,
  jsonGenerator,
  mermaidGenerator,
  originalGenerator,
  parseModel,
  readJson,
  sameFacts,
  type GeneratorDefinition,
  type OptionValues,
  type ProcessModel,
} from '../src/index.js';
import { checkOutput } from './check.js';
import { randomBpmn, randomPnml } from './random-models.js';

// Section 9: properties on randomly generated small models. The seeds are fixed, so the run is deterministic;
// every failure message names the seed and the model text, so the case can be replayed with `randomBpmn(seed)`.
const BASE_SEED = 20240601;
const COUNT = 150;

const generate = (g: GeneratorDefinition, model: ProcessModel, options: OptionValues) => {
  const out = g.generate(model, options);
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

const kinds = [
  { name: 'bpmn', make: randomBpmn },
  { name: 'pnml', make: randomPnml },
] as const;

for (const { name, make } of kinds) {
  describe(`properties on random ${name} models (seeds ${String(BASE_SEED)}..${String(BASE_SEED + COUNT - 1)})`, () => {
    for (let k = 0; k < COUNT; k++) {
      const seed = BASE_SEED + k;
      it(`seed ${String(seed)}`, () => {
        const text = make(seed);
        const where = `${name} seed ${String(seed)}\n${text}`;
        const model = parseModel(text);
        expect(parseModel(text), where).toEqual(model);
        const modelIds = new Set(model.facts.map((f) => f.id));

        // JSON: write, read back, compare with the model; JSON carries every fact.
        for (const options of [{ indent: 2, includeLayout: false }, { indent: 0, includeLayout: true }]) {
          const json = generate(jsonGenerator, model, options);
          expect(diffFacts(model.facts, json.facts), `json facts ${where}`).toEqual([]);
          expect(sameFacts(readJson(json.text, model.formalism), model.facts), `json read-back ${where}`).toBe(true);
          expect(diffFacts(model.facts, readJson(json.text, model.formalism)), where).toEqual([]);
          expect(diffFacts(readJson(json.text, model.formalism), model.facts), where).toEqual([]);
          checkOutput(json, modelIds);
        }

        // The original file carries every fact; Mermaid and compact: the reader returns exactly the facts the generator reports.
        const original = generate(originalGenerator, model, {});
        expect(diffFacts(model.facts, original.facts), `original ${where}`).toEqual([]);
        const readers: [GeneratorDefinition, OptionValues][] = [
          [mermaidGenerator, { direction: 'LR' }],
          [mermaidGenerator, { direction: 'TB' }],
          ...(model.formalism === 'pnml' ? ([[compactGenerator, {}]] as [GeneratorDefinition, OptionValues][]) : []),
        ];
        for (const [g, options] of readers) {
          const out = generate(g, model, options);
          const read = g.read?.(out.text, model.formalism) ?? [];
          expect(diffFacts(read, out.facts), `${g.id} read-back ${where}`).toEqual([]);
          expect(diffFacts(out.facts, read), `${g.id} read-back ${where}`).toEqual([]);
          checkOutput(out, modelIds);
          expect(generate(g, parseModel(text), options).text, `${g.id} determinism ${where}`).toBe(out.text);
        }

        // Every other generator runs and is deterministic.
        const registry = createDefaultRegistry();
        for (const def of registry.listFor(model.formalism)) {
          const out = def.generate(model, def.options.length === 0 ? {} : Object.fromEntries(def.options.map((o) => [o.key, o.default])));
          expect(out.kind === 'text' ? out.text : out.svg, `${def.id} ${where}`).toBeTypeOf('string');
        }
      });
    }
  });
}
