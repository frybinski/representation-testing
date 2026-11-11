import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry, loadDefaultTokenizer, parseModel, type Tokenizer } from '@repr-werkbank/core';
import { completeOf, partialOf, startRequest } from '../src/pipeline.ts';
import { largeBpmn, largePnml } from '../../core/test/large-models.ts';

// NF-02: models with up to 500 nodes are processed without noticeable waiting. This is the whole worker pipeline under Node (parse, every
// representation including the diagram with its automatic layout, figures with the tokenizer, inventory, structure report, bundle),
// without the browser. The budgets are generous on purpose: a shared CI machine can be several times slower than the machine they were
// measured on (H77). They catch an accidental quadratic step, not a few percent.
const FIRST_BUDGET_MS = 3000;
const COMPLETE_BUDGET_MS = 6000;

const registry = createDefaultRegistry();
let tokenizer: Tokenizer;
beforeAll(async () => {
  tokenizer = await loadDefaultTokenizer();
});

describe('large models (NF-02)', () => {
  it.each([
    ['BPMN', largeBpmn(500)],
    ['PNML', largePnml(500)],
  ])('processes a generated 500-node %s model within the budget', (_name, text) => {
    const model = parseModel(text);
    expect(model.nodes.length + model.edges.length).toBeGreaterThan(500);
    const t0 = performance.now();
    const stage = startRequest({ type: 'run', id: 1, text, inputName: 'large', options: {} }, tokenizer, registry);
    const partial = partialOf(1, stage, 0);
    const first = performance.now() - t0;
    const done = completeOf(1, stage, 0);
    const total = performance.now() - t0;
    console.log(`${_name}: ${String(model.nodes.length)} nodes, ${String(model.edges.length)} edges, first result ${first.toFixed(0)} ms, complete ${total.toFixed(0)} ms`);
    expect(partial.representations.some((r) => r.id === 'diagram')).toBe(true);
    expect(JSON.parse(done.bundleJson)).toHaveProperty('structureReport');
    expect(first).toBeLessThan(FIRST_BUDGET_MS);
    expect(total).toBeLessThan(COMPLETE_BUDGET_MS);
  });

  it('generates exactly the requested node counts and is deterministic', () => {
    expect(parseModel(largeBpmn(500)).nodes.filter((n) => n.type !== 'process').length).toBe(500);
    expect(parseModel(largePnml(500)).nodes.filter((n) => n.type === 'place' || n.type === 'transition').length).toBe(499);
    expect(largeBpmn(500)).toBe(largeBpmn(500));
    expect(largePnml(500)).toBe(largePnml(500));
  });
});
