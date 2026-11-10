import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { compactGenerator, createDefaultRegistry, diffFacts, jsonGenerator, mermaidGenerator, sameFacts, type GeneratorDefinition, type OptionValues } from '../src/index.js';
import { checkOutput } from './check.js';
import { allCases, modelOf } from './special.js';

const jsonSchema = JSON.parse(readFileSync(new URL('../../../docs/json-representation.schema.json', import.meta.url), 'utf8')) as object;
const validateJson = new Ajv2020({ strict: true }).compile(jsonSchema);

interface Variant {
  generator: GeneratorDefinition;
  options: OptionValues;
}

export const variants: Variant[] = [
  { generator: jsonGenerator, options: { indent: 2, includeLayout: false } },
  { generator: jsonGenerator, options: { indent: 0, includeLayout: true } },
  { generator: jsonGenerator, options: { indent: 4, includeLayout: true } },
  { generator: compactGenerator, options: {} },
  { generator: mermaidGenerator, options: { direction: 'LR' } },
  { generator: mermaidGenerator, options: { direction: 'TB' } },
];

/** FA-52 requires readers for these three; the others are listed so that adding or removing a reader is a deliberate change. */
const MUST_HAVE_READER = ['json', 'mermaid', 'compact'];
const NO_READER = ['original', 'original-no-layout', 'verbalization'];

describe('which generators have a reader', () => {
  const registry = createDefaultRegistry();
  it('the generators of FA-52 have a reader', () => {
    for (const id of MUST_HAVE_READER) expect('read' in registry.get(id) && registry.get(id).read !== undefined, id).toBe(true);
  });
  it('the set of readers is exactly the documented one', () => {
    const withReader = registry.list().filter((g) => g.read !== undefined).map((g) => g.id).sort();
    expect(withReader).toEqual([...MUST_HAVE_READER].sort());
    for (const id of NO_READER) expect(registry.get(id).read !== undefined, id).toBe(false);
  });
  it('every variant below belongs to a generator that must have a reader', () => {
    for (const { generator } of variants) expect(MUST_HAVE_READER).toContain(generator.id);
  });
});

describe('read-back: facts read from the generated text equal the facts reported as carried (FA-52)', () => {
  for (const { generator, options } of variants) {
    describe(`${generator.id} ${JSON.stringify(options)}`, () => {
      for (const c of allCases) {
        if (!generator.formalisms.includes(c.formalism)) continue;
        it(c.name, () => {
          expect(generator.read !== undefined, `${generator.id} must have a reader`).toBe(true);
          const model = modelOf(c);
          const out = generator.generate(model, options);
          if (out.kind !== 'text') throw new Error('text expected');
          const read = generator.read?.(out.text, model.formalism) ?? [];
          expect(diffFacts(read, out.facts)).toEqual([]);
          expect(diffFacts(out.facts, read)).toEqual([]);
          expect(sameFacts(read, out.facts)).toBe(true);
          checkOutput(out, new Set(model.facts.map((f) => f.id)));
          // Determinism (R-5): same input, same options, same bytes.
          const again = generator.generate(modelOf(c), options);
          expect(again.kind === 'text' && again.text).toBe(out.text);
          expect(again).toEqual(out);
        });
      }
    });
  }
});

describe('json representation', () => {
  for (const c of allCases) {
    for (const includeLayout of [false, true]) {
      it(`${c.name}: valid against docs/json-representation.schema.json (layout=${String(includeLayout)})`, () => {
        const out = jsonGenerator.generate(modelOf(c), { indent: 2, includeLayout });
        if (out.kind !== 'text') throw new Error('text expected');
        expect(validateJson(JSON.parse(out.text))).toBe(true);
      });
    }
  }

  it('carries everything except layout by default, and layout when asked', () => {
    const c = allCases.find((x) => x.name.endsWith('order-handling.bpmn'));
    if (!c) throw new Error('missing example');
    const m = modelOf(c);
    const plain = jsonGenerator.generate(m, { indent: 2, includeLayout: false });
    const withLayout = jsonGenerator.generate(m, { indent: 2, includeLayout: true });
    expect(plain.facts.length).toBe(m.facts.filter((f) => f.category !== 'layout').length);
    expect(withLayout.facts.length).toBe(m.facts.length);
  });

  it('rejects a document of another format', () => {
    expect(() => jsonGenerator.read?.('{"format":"x"}', 'bpmn')).toThrow(/unknown format/);
    expect(validateJson({ format: 'x' })).toBe(false);
  });
});
