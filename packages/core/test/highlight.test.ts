import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  combine,
  createDefaultRegistry,
  elementOfFact,
  elementRanges,
  elementsAt,
  parseModel,
  type ProcessModel,
  type TextOutput,
} from '../src/index.js';
import { decodeId, encodeId, encodeLabel } from '../src/index.js';

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
const registry = createDefaultRegistry();
const REPRESENTATIONS: { id: string; options: Record<string, string | boolean> }[] = [
  { id: 'mermaid', options: {} },
  { id: 'json', options: {} },
  { id: 'verbalization', options: { language: 'en' } },
  { id: 'verbalization', options: { language: 'de' } },
  { id: 'compact', options: {} },
  { id: 'original', options: {} },
  { id: 'original-no-layout', options: {} },
];

describe('highlight index (FA-61)', () => {
  for (const rel of EXAMPLES) {
    const model = load(rel);
    for (const rep of REPRESENTATIONS) {
      if (!registry.get(rep.id).formalisms.includes(model.formalism)) continue;
      const label = `${rel} ${rep.id}${typeof rep.options.language === 'string' ? ` ${rep.options.language}` : ''}`;
      it(`${label}: every carried node and edge has a range, and the range shows its id or label`, () => {
        const out = registry.run(rep.id, model, rep.options) as TextOutput;
        const ranges = elementRanges(model, out);
        const carried = new Set(out.facts.map((f) => elementOfFact(model, f)).filter((k): k is string => k !== null));
        const spanned = new Set(out.spans.flatMap((s) => s.factIds));
        for (const key of carried) {
          // An element whose carried facts no span mentions has nothing to highlight; every format here spans all of them.
          const hasSpan = out.facts.some((f) => elementOfFact(model, f) === key && spanned.has(f.id));
          expect(hasSpan, `${label}: no span for ${key}`).toBe(true);
          expect(ranges.get(key)?.length ?? 0, `${label}: no range for ${key}`).toBeGreaterThan(0);
        }
        for (const key of ranges.keys()) expect(carried.has(key) || out.facts.length === 0, `${label}: range for uncarried ${key}`).toBe(true);
        for (const n of model.nodes) {
          const rs = ranges.get(n.id);
          if (!rs) continue;
          const texts = rs.map((r) => out.text.slice(r.start, r.end));
          const wanted = [n.id, encodeId(n.id), n.name ?? '', encodeLabel(n.name ?? '')].filter((s) => s !== '');
          if (n.name === undefined && rep.id === 'verbalization') continue; // such a node is referred to by an alias, not by its id
          if (!n.idExplicit && n.name === undefined) continue;
          expect(
            wanted.some((w) => texts.some((t) => t.includes(w) || t.includes(decodeId(w)))),
            `${label}: range text of ${n.id} shows neither id nor label`,
          ).toBe(true);
        }
        // ranges are sorted, disjoint and inside the text
        for (const rs of ranges.values()) {
          rs.forEach((r, i) => {
            expect(r.start).toBeGreaterThanOrEqual(0);
            expect(r.end).toBeLessThanOrEqual(out.text.length);
            expect(r.end).toBeGreaterThan(r.start);
            if (i > 0) expect(r.start).toBeGreaterThan(rs[i - 1]?.end ?? -1);
          });
        }
      });
      it(`${label}: elementsAt returns the elements whose ranges contain the offset, innermost first`, () => {
        const out = registry.run(rep.id, model, rep.options) as TextOutput;
        const ranges = elementRanges(model, out);
        const step = Math.max(1, Math.floor(out.text.length / 400));
        for (let offset = 0; offset < out.text.length; offset += step) {
          const at = elementsAt(model, out, offset);
          const expected = [...ranges].filter(([, rs]) => rs.some((r) => offset >= r.start && offset < r.end)).map(([k]) => k);
          expect([...at].sort()).toEqual([...expected].sort());
          const lengths = at.map((k) => Math.min(...(ranges.get(k) ?? []).filter((r) => offset >= r.start && offset < r.end).map((r) => r.end - r.start)));
          expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
        }
        expect(elementsAt(model, out, out.text.length + 5)).toEqual([]);
      });
    }
  }

  it('finds the task in the original file and puts it before the process that contains it', () => {
    const model = load('bpmn/order-handling.bpmn');
    const out = registry.run('original', model) as TextOutput;
    const at = out.text.indexOf('name="Check order"');
    const found = elementsAt(model, out, at);
    expect(found[0]).toBe('Check');
    expect(found).toContain('Process_order');
    expect(found.indexOf('Process_order')).toBeGreaterThan(0);
  });

  it('works on a combination (spans are shifted by their part)', () => {
    const model = load('bpmn/order-handling.bpmn');
    const c = combine(registry, model, [{ generator: 'verbalization', options: { language: 'en' } }, { generator: 'mermaid' }]);
    const part = c.parts[1];
    expect(part).toBeDefined();
    const ranges = elementRanges(model, c);
    const inMermaid = (ranges.get('Check') ?? []).filter((r) => r.start >= (part?.start ?? 0));
    expect(inMermaid.length).toBeGreaterThan(0);
    expect(c.text.slice(inMermaid[0]?.start, inMermaid[0]?.end)).toContain('Check');
  });

  it('elementOfFact maps node and edge facts to the key and unknown subjects to null', () => {
    const model = load('bpmn/order-handling.bpmn');
    const label = model.facts.find((f) => f.category === 'label' && f.subject === 'Check');
    const flow = model.facts.find((f) => f.category === 'sequenceFlow');
    expect(label && elementOfFact(model, label)).toBe('Check');
    expect(flow && elementOfFact(model, flow)).toBe(flow?.subject);
    expect(elementOfFact(model, { id: 'x', category: 'node', subject: 'nope', aspect: '', value: '' })).toBeNull();
  });
});
