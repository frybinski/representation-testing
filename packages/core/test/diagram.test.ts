import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, diagramOutput, parseModel, type ImageOutput, type ProcessModel } from '../src/index.js';
import { bpmn, pnml } from './helpers.js';
import { randomBpmn, randomPnml } from './random-models.js';
import { parseSvg, textOf } from './svg-helpers.js';

const EXAMPLES = [
  'bpmn/order-handling.bpmn',
  'bpmn/collaboration.bpmn',
  'pnml/pm4py-dialect.pnml',
  'pnml/producer-consumer.pnml',
  'pnml/wf-deadlock.pnml',
  'pnml/wf-large.pnml',
  'pnml/wf-sound.pnml',
];
const load = (rel: string): ProcessModel => parseModel(readFileSync(new URL(`../../../examples/${rel}`, import.meta.url), 'utf8'));
const OPTIONS = [
  { layout: 'file', direction: 'LR', showConditions: false },
  { layout: 'auto', direction: 'LR', showConditions: false },
  { layout: 'auto', direction: 'TB', showConditions: true },
];

describe('diagram generator', () => {
  for (const rel of EXAMPLES) {
    describe(rel, () => {
      const model = load(rel);
      for (const options of OPTIONS) {
        const name = `${options.layout} ${options.direction}${options.showConditions ? ' +conditions' : ''}`;
        it(`${name}: well-formed SVG with the documented root and one group per drawn element`, () => {
          const out = diagramOutput(model, options);
          expect(out.svg).not.toMatch(/NaN|Infinity|undefined/);
          const doc = parseSvg(out.svg);
          const root = doc.documentElement;
          expect(root.localName).toBe('svg');
          expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
          expect(root.getAttribute('role')).toBe('img');
          expect(root.getAttribute('width')).toBe(String(out.width));
          expect(root.getAttribute('height')).toBe(String(out.height));
          expect(root.getAttribute('viewBox')?.split(' ')[2]).toBe(String(out.width));
          expect(root.getAttribute('data-layout-source')).toBe(out.layout.source);
          expect(doc.querySelector('title')?.textContent).not.toBe('');
          const groups = [...doc.querySelectorAll('g[data-element]')];
          const keys = groups.map((g) => `${g.getAttribute('data-kind') ?? ''}:${g.getAttribute('data-element') ?? ''}`);
          expect(new Set(keys).size).toBe(keys.length);
          for (const g of groups) expect(['node', 'edge']).toContain(g.getAttribute('data-kind'));
          const ids = new Set(model.nodes.map((n) => n.id));
          const edgeKeys = new Set(model.edges.map((e) => e.key));
          for (const g of groups) {
            const key = g.getAttribute('data-element') ?? '';
            expect(g.getAttribute('data-kind') === 'node' ? ids.has(key) : edgeKeys.has(key), key).toBe(true);
          }
          expect(groups.length).toBeGreaterThan(0);
        });
        it(`${name}: deterministic (same bytes twice, after re-reading, and with reversed key order in the model)`, () => {
          const a = diagramOutput(model, options).svg;
          expect(diagramOutput(load(rel), options).svg).toBe(a);
          const reversed = reverseKeys<ProcessModel>(structuredClone(model));
          expect(diagramOutput(reversed, options).svg).toBe(a);
        });
      }
    });
  }

  it('uses the file layout when it is complete and says why it did not when it is not', () => {
    const src = (rel: string, layout: string): ImageOutput => diagramOutput(load(rel), { layout, direction: 'LR', showConditions: false });
    expect(src('bpmn/order-handling.bpmn', 'file').layout).toEqual({ source: 'file', fallback: '' });
    expect(src('pnml/producer-consumer.pnml', 'file').layout).toEqual({ source: 'file', fallback: '' });
    const noDi = src('bpmn/collaboration.bpmn', 'file');
    expect(noDi.layout.source).toBe('auto');
    expect(noDi.layout.fallback).toMatch(/no bounds for participant "Customer"/);
    expect(noDi.svg).toContain('data-layout-source="auto"');
    expect(noDi.svg).toContain('<!-- layout: automatic, because the file layout is not usable');
    const requested = src('bpmn/order-handling.bpmn', 'auto');
    expect(requested.layout).toEqual({ source: 'auto', fallback: '' });
    expect(requested.svg).not.toContain('<!--');
    expect(src('pnml/wf-sound.pnml', 'file').layout.source).toBe('auto');
  });

  it('falls back to automatic layout for the whole diagram when one element lacks its coordinates', () => {
    const model = parseModel(
      bpmn(`<process id="p"><startEvent id="a"/><task id="b" name="B"/><sequenceFlow id="f" sourceRef="a" targetRef="b"/></process>
<bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="p">
<bpmndi:BPMNShape id="a_di" bpmnElement="a"><dc:Bounds x="10" y="10" width="36" height="36"/></bpmndi:BPMNShape>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`),
    );
    const out = diagramOutput(model, { layout: 'file', direction: 'LR', showConditions: false });
    expect(out.layout.source).toBe('auto');
    expect(out.layout.fallback).toContain('no bounds for task "b"');
  });

  it('does not draw the children of a collapsed sub-process (the file hides them as well)', () => {
    const out = diagramOutput(load('bpmn/order-handling.bpmn'), { layout: 'file', direction: 'LR', showConditions: false });
    const doc = parseSvg(out.svg);
    const drawn = new Set([...doc.querySelectorAll('g[data-kind="node"]')].map((g) => g.getAttribute('data-element')));
    expect(drawn.has('Ship')).toBe(true);
    for (const hidden of ['ShipStart', 'Pack', 'ShipEnd', 'OrderData']) expect(drawn.has(hidden), hidden).toBe(false);
    const auto = parseSvg(diagramOutput(load('bpmn/order-handling.bpmn'), { layout: 'auto', direction: 'LR', showConditions: false }).svg);
    expect(auto.querySelector('g[data-element="Pack"]')).not.toBeNull();
  });

  it('is registered for both formalisms with self-describing options', () => {
    const def = createDefaultRegistry().get('diagram');
    expect(def.kind).toBe('image');
    expect(def.mime).toBe('image/svg+xml');
    expect(def.extension).toBe('svg');
    expect(def.formalisms).toEqual(['bpmn', 'pnml']);
    expect(def.options.map((o) => o.key)).toEqual(['layout', 'direction', 'showConditions']);
  });

  it('escapes every label (no markup from the model)', () => {
    const model = parseModel(pnml(`<page id="pg"><place id="p"><name><text>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q"</text></name></place></page>`));
    const out = diagramOutput(model, { layout: 'auto', direction: 'LR', showConditions: false });
    expect(out.svg).not.toContain('<script');
    const doc = parseSvg(out.svg);
    // The long word is broken between characters, so compare without spaces.
    expect(textOf(doc.querySelector('g[data-element="p"] text') as Element).replaceAll(' ', '')).toContain('<script>alert(1)</script>&"q"');
  });

  it('draws the two kinds of tokens, weights and silent transitions of a Petri net', () => {
    const model = load('pnml/pm4py-dialect.pnml');
    const doc = parseSvg(diagramOutput(model, { layout: 'auto', direction: 'LR', showConditions: false }).svg);
    expect(doc.querySelectorAll('g.rb-silent').length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('circle.rb-token').length).toBe(1);
    expect(doc.querySelector('g[data-element="sink"]')?.textContent).toContain('final: 1');
    const pc = parseSvg(diagramOutput(load('pnml/producer-consumer.pnml'), { layout: 'file', direction: 'LR', showConditions: false }).svg);
    expect(pc.querySelector('g.rb-arc text')?.textContent).toBe('2');
  });

  for (const [name, make] of [
    ['bpmn', randomBpmn],
    ['pnml', randomPnml],
  ] as const) {
    it(`draws 150 random ${name} models without error, as well-formed deterministic SVG`, () => {
      for (let k = 0; k < 150; k++) {
        const seed = 20240601 + k;
        const text = make(seed);
        const model = parseModel(text);
        for (const options of OPTIONS) {
          const out = diagramOutput(model, options);
          expect(out.svg, `seed ${String(seed)}`).not.toMatch(/NaN|Infinity|undefined/);
          const doc = parseSvg(out.svg);
          expect(doc.querySelector('parsererror'), `seed ${String(seed)}`).toBeNull();
          expect(diagramOutput(parseModel(text), options).svg, `seed ${String(seed)}`).toBe(out.svg);
        }
      }
    });
  }
});

function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return (value as unknown[]).map((v) => reverseKeys(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).reverse()) out[k] = reverseKeys((value as Record<string, unknown>)[k]);
    return out as T;
  }
  return value;
}
