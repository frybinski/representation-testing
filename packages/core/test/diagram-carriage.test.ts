import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInventory, computeInventory, createDefaultRegistry, diagramOutput, parseModel, type ImageOutput, type ProcessModel } from '../src/index.js';
import { parseSvg, textOf } from './svg-helpers.js';
import { normalizeLabel } from '../src/diagram/metrics.js';
import { randomBpmn, randomPnml } from './random-models.js';

const load = (rel: string): ProcessModel => parseModel(readFileSync(new URL(`../../../examples/${rel}`, import.meta.url), 'utf8'));
const EXAMPLES = [
  'bpmn/order-handling.bpmn',
  'bpmn/collaboration.bpmn',
  'pnml/pm4py-dialect.pnml',
  'pnml/producer-consumer.pnml',
  'pnml/wf-deadlock.pnml',
  'pnml/wf-large.pnml',
  'pnml/wf-sound.pnml',
];
const OPTIONS = [
  { layout: 'file', direction: 'LR', showConditions: false },
  { layout: 'auto', direction: 'LR', showConditions: true },
];
const squash = (s: string): string => s.replace(/\s+/gu, '');

/** Checks the three rules of FA-53 / plan 2.2 for one diagram. */
export function checkCarriage(model: ProcessModel, out: ImageOutput, where: string): void {
  const doc = parseSvg(out.svg);
  const groups = new Map<string, Element>();
  for (const g of doc.querySelectorAll('g[data-element]')) groups.set(`${g.getAttribute('data-kind') ?? ''}:${g.getAttribute('data-element') ?? ''}`, g);
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const modelFacts = new Map(model.facts.map((f) => [f.id, f]));
  expect(Object.keys(out.encoding).sort(), where).toEqual(out.facts.map((f) => f.id).sort());
  for (const f of out.facts) {
    expect(modelFacts.has(f.id), `${where}: ${f.id} is a model fact`).toBe(true);
    const kind = nodeIds.has(f.subject) ? 'node' : 'edge';
    const group = groups.get(`${kind}:${f.subject}`);
    expect(group, `${where}: no element group for the subject of ${f.id}`).toBeDefined();
    expect(f.category, where).not.toBe('identifier');
    const how = out.encoding[f.id];
    expect(['text', 'visual'], `${where}: ${f.id}`).toContain(how);
    if (how === 'text' && group) {
      const written = squash([...group.querySelectorAll('text')].map((t) => textOf(t)).join(' '));
      expect(written, `${where}: text fact ${f.id} is not written in the image`).toContain(squash(normalizeLabel(f.value)));
    }
  }
  // Text facts are only of categories whose value is a string a reader can read.
  for (const f of out.facts) {
    if (out.encoding[f.id] === 'text') expect(['label', 'sequenceFlowName', 'condition', 'annotation', 'arcWeight', 'initialMarking', 'finalMarking'], `${where}: ${f.id}`).toContain(f.category);
  }
}

describe('diagram carriage (FA-53)', () => {
  for (const rel of EXAMPLES) {
    for (const options of OPTIONS) {
      it(`${rel} ${options.layout}${options.showConditions ? ' +conditions' : ''}: text facts are written, every subject has a group`, () => {
        const model = load(rel);
        checkCarriage(model, diagramOutput(model, options), `${rel} ${options.layout}`);
      });
    }
  }

  for (const [name, make] of [
    ['bpmn', randomBpmn],
    ['pnml', randomPnml],
  ] as const) {
    it(`holds for 150 random ${name} models`, () => {
      for (let k = 0; k < 150; k++) {
        const seed = 20240601 + k;
        const model = parseModel(make(seed));
        for (const options of OPTIONS) checkCarriage(model, diagramOutput(model, options), `seed ${String(seed)} ${options.layout}`);
      }
    });
  }

  const how = (model: ProcessModel, options: Record<string, string | boolean>, category: string, subject?: string): string[] => {
    const out = diagramOutput(model, { layout: 'file', direction: 'LR', showConditions: false, ...options });
    return out.facts.filter((f) => f.category === category && (subject === undefined || f.subject === subject)).map((f) => out.encoding[f.id] ?? '');
  };

  it('BPMN: labels are text; types, flows and default flows are visual; identifiers and conditions are not carried', () => {
    const m = load('bpmn/order-handling.bpmn');
    expect(how(m, {}, 'label', 'Check')).toEqual(['text']);
    expect(how(m, {}, 'nodeType', 'Check')).toEqual(['visual']);
    expect(how(m, {}, 'identifier')).toEqual([]);
    expect(how(m, {}, 'condition')).toEqual([]);
    expect(how(m, { showConditions: true }, 'condition')).toEqual(['text']);
    expect(how(m, {}, 'defaultFlow')).toEqual(['visual']);
    expect(how(m, {}, 'sequenceFlowName').sort()).toEqual(['text', 'text']);
    expect(how(m, {}, 'eventType', 'Wait')).toEqual(['visual']);
    expect(how(m, {}, 'annotation').sort()).toEqual(['text', 'visual']); // kind and text; the plain association is not carried
    expect(how(m, {}, 'layout').length).toBeGreaterThan(0);
    expect(how(m, { layout: 'auto' }, 'layout')).toEqual([]);
    // The file layout hides the children of the collapsed sub-process: their facts are not carried.
    const out = diagramOutput(m, { layout: 'file', direction: 'LR', showConditions: false });
    expect(out.facts.some((f) => f.subject === 'Pack')).toBe(false);
    const auto = diagramOutput(m, { layout: 'auto', direction: 'LR', showConditions: false });
    expect(auto.facts.some((f) => f.subject === 'Pack' && f.category === 'node')).toBe(true);
  });

  it('BPMN collaboration: pools and lanes are visual, message flow names are text', () => {
    const m = load('bpmn/collaboration.bpmn');
    const out = diagramOutput(m, { layout: 'auto', direction: 'LR', showConditions: false });
    const enc = (category: string, aspect: string): string[] => out.facts.filter((f) => f.category === category && f.aspect === aspect).map((f) => out.encoding[f.id] ?? '');
    expect(new Set(enc('poolLane', 'kind'))).toEqual(new Set(['visual']));
    expect(enc('poolLane', 'member').length).toBe(m.facts.filter((f) => f.category === 'poolLane' && f.aspect === 'member').length);
    expect(enc('poolLane', 'process').length).toBe(2);
    expect(enc('messageFlow', '').length).toBe(3);
    expect(out.facts.filter((f) => f.category === 'label' && f.subject.startsWith('[')).map((f) => out.encoding[f.id])).toEqual(['text', 'text', 'text']);
    // An intermediate catching event has a definition in this model, so its type is carried.
    expect(out.facts.some((f) => f.category === 'nodeType' && f.subject === 'Await')).toBe(true);
  });

  it('Petri nets: tokens up to 5 are visual, weights and final markings are text, silent transitions are visual', () => {
    const pc = load('pnml/producer-consumer.pnml');
    expect(how(pc, {}, 'initialMarking')).toEqual(['visual', 'visual']);
    expect(how(pc, {}, 'arcWeight')).toEqual(['text']);
    expect(how(pc, {}, 'layout').length).toBeGreaterThan(0);
    const py = load('pnml/pm4py-dialect.pnml');
    expect(how(py, {}, 'finalMarking')).toEqual(['text']);
    expect(how(py, {}, 'silentTransition').length).toBeGreaterThan(0);
    expect(new Set(how(py, {}, 'silentTransition'))).toEqual(new Set(['visual']));
  });

  it('a marking above 5 is written as a number (text)', () => {
    const m = parseModel(`<?xml version="1.0"?><pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="pg"><place id="p"><initialMarking><text>7</text></initialMarking></place></page></net></pnml>`);
    expect(how(m, { layout: 'auto' }, 'initialMarking')).toEqual(['text']);
  });

  it('inventory: the diagram column has asText and visual that add up; text columns have neither; statuses follow the union', () => {
    for (const rel of EXAMPLES) {
      const model = load(rel);
      const registry = createDefaultRegistry();
      const inv = computeInventory(registry, model);
      for (const col of inv.columns) {
        for (const cell of col.cells) {
          if (col.id === 'diagram') {
            expect(cell.asText, rel).toBeDefined();
            expect((cell.asText ?? 0) + (cell.visual ?? 0), `${rel} ${cell.category}`).toBe(cell.carried);
          } else {
            expect('asText' in cell, `${rel} ${col.id}`).toBe(false);
            expect('visual' in cell, `${rel} ${col.id}`).toBe(false);
          }
        }
      }
      // The same facts as a text carrier give the same status and counts.
      const diagram = diagramOutput(model, { layout: 'file', direction: 'LR', showConditions: false });
      const plain = buildInventory(model, [{ id: 'd', facts: diagram.facts }]);
      const withEnc = buildInventory(model, [{ id: 'd', facts: diagram.facts, encoding: diagram.encoding }]);
      expect(withEnc.columns[0]?.cells.map((c) => [c.category, c.carried, c.total, c.status])).toEqual(plain.columns[0]?.cells.map((c) => [c.category, c.carried, c.total, c.status]));
    }
  });
});
