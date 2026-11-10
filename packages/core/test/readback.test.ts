import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { diffFacts, jsonGenerator, sameFacts, type GeneratorDefinition, type OptionValues, type TextOutput } from '../src/index.js';
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
];

/** Structural checks every text output must pass, whatever the generator. */
export function checkOutput(out: TextOutput, modelFactIds: Set<string>): void {
  const carried = new Set(out.facts.map((f) => f.id));
  expect(carried.size).toBe(out.facts.length);
  for (const f of out.facts) expect(modelFactIds.has(f.id)).toBe(true);
  const covered = new Set<string>();
  for (const s of out.spans) {
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.start).toBeLessThan(s.end);
    expect(s.end).toBeLessThanOrEqual(out.text.length);
    expect(s.factIds.length).toBeGreaterThan(0);
    for (const id of s.factIds) {
      expect(carried.has(id)).toBe(true);
      covered.add(id);
    }
  }
  // Every carried fact has at least one place in the text.
  expect(diffFacts(out.facts, out.facts.filter((f) => covered.has(f.id)))).toEqual([]);
}

describe('read-back: facts read from the generated text equal the facts reported as carried (FA-52)', () => {
  for (const { generator, options } of variants) {
    describe(`${generator.id} ${JSON.stringify(options)}`, () => {
      for (const c of allCases) {
        if (!generator.formalisms.includes(c.formalism) || !generator.read) continue;
        it(c.name, () => {
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
