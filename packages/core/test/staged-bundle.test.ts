import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GeneratorRegistry,
  createBundle,
  createDefaultRegistry,
  finishBundle,
  loadDefaultTokenizer,
  runAdditions,
  serializeBundle,
  startBundle,
  type GeneratorDefinition,
  type Tokenizer,
} from '../src/index.js';

const EXAMPLES = ['bpmn/order-handling.bpmn', 'bpmn/collaboration.bpmn', 'pnml/pm4py-dialect.pnml', 'pnml/producer-consumer.pnml', 'pnml/wf-deadlock.pnml', 'pnml/wf-large.pnml', 'pnml/wf-sound.pnml'];
const read = (rel: string): string => readFileSync(new URL(`../../../examples/${rel}`, import.meta.url), 'utf8');
let tokenizer: Tokenizer;
beforeAll(async () => {
  tokenizer = await loadDefaultTokenizer();
});

describe('staged bundle creation (NF-02)', () => {
  for (const rel of EXAMPLES) {
    it(`${rel}: the assembled bundle is byte-identical to createBundle`, () => {
      const text = read(rel);
      const name = rel.split('/')[1] ?? rel;
      const stage = startBundle(text, { tokenizer, inputName: name });
      const staged = finishBundle(stage, runAdditions(stage));
      expect(serializeBundle(staged)).toBe(serializeBundle(createBundle(text, { tokenizer, inputName: name })));
    });
  }

  it('is identical with changed options too', () => {
    const text = read('pnml/wf-sound.pnml');
    const options = { 'structure-report': { language: 'de', maxCycles: 5 }, 'structure-report-json': { maxCycles: 5 }, verbalization: { language: 'de' }, diagram: { layout: 'auto', direction: 'TB' } };
    const stage = startBundle(text, { tokenizer, options });
    expect(serializeBundle(finishBundle(stage, runAdditions(stage)))).toBe(serializeBundle(createBundle(text, { tokenizer, options })));
  });

  it('the first phase runs no addition and shows what the final bundle will contain', () => {
    const calls: string[] = [];
    const registry = new GeneratorRegistry();
    for (const def of createDefaultRegistry().list()) {
      const wrapped: GeneratorDefinition = { ...def, generate: (m, o) => (calls.push(def.id), def.generate(m, o)) };
      registry.register(wrapped);
    }
    const text = read('pnml/wf-sound.pnml');
    const stage = startBundle(text, { tokenizer, registry });
    expect(calls).not.toContain('structure-report');
    expect(calls).not.toContain('structure-report-json');
    expect(stage.pending).toEqual(['structure-report', 'structure-report-json']);
    const additions = runAdditions(stage);
    expect(additions.map((a) => a.id)).toEqual(stage.pending);
    expect(calls.filter((c) => c.startsWith('structure-report')).sort()).toEqual(['structure-report', 'structure-report-json']);
    const full = finishBundle(stage, additions);
    // each generator ran exactly once over both phases
    expect(calls.length).toBe(new Set(calls).size);
    expect(stage.partial.metadata).toEqual(full.metadata);
    expect(stage.partial.representations).toEqual(full.representations);
    expect(stage.partial.inventory).toEqual(full.inventory);
    expect(stage.partial.notices).toEqual(full.notices);
    expect(full.figures.rows.map((r) => r.id)).toEqual(['original', 'original-no-layout', 'json', 'mermaid', 'compact', 'verbalization', 'structure-report', 'structure-report-json']);
    expect(stage.partial.figures.rows.map((r) => r.id)).toEqual(['original', 'original-no-layout', 'json', 'mermaid', 'compact', 'verbalization']);
    expect(full.figures.rows.slice(0, 6)).toEqual(stage.partial.figures.rows);
    expect(full.structureReport).not.toBeNull();
    expect(stage.partial.metadata.generators.map((g) => g.id)).toContain('structure-report');
  });

  it('rejects wrong options before any work and additions that do not match the stage', () => {
    const text = read('pnml/wf-sound.pnml');
    expect(() => startBundle(text, { tokenizer, options: { 'structure-report': { maxStates: 5 } } })).toThrow(/maxStates/);
    const stage = startBundle(text, { tokenizer });
    expect(() => finishBundle(stage, [])).toThrow(/pending/);
    expect(() => startBundle('not a model', { tokenizer })).toThrow();
  });
});
