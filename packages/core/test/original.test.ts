import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GeneratorRegistry,
  cutRanges,
  originalGenerator,
  originalNoLayoutGenerator,
  parseModel,
  resolveOptions,
  sameFacts,
  type TextOutput,
} from '../src/index.js';
import { bpmn, pnml } from './helpers.js';

const root = new URL('../../../examples/', import.meta.url);
const examples = (['bpmn', 'pnml'] as const).flatMap((d) =>
  readdirSync(new URL(`${d}/`, root))
    .filter((f) => f.endsWith(`.${d}`))
    .sort()
    .map((f) => ({ name: `${d}/${f}`, text: readFileSync(new URL(`${d}/${f}`, root), 'utf8') })),
);
const reg = new GeneratorRegistry().register(originalGenerator).register(originalNoLayoutGenerator);
const run = (id: string, text: string, options = {}): TextOutput => {
  const out = reg.run(id, parseModel(text), options);
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

describe('FA-20 original', () => {
  for (const ex of examples) {
    it(`${ex.name}: text is unchanged and carries every fact`, () => {
      const m = parseModel(ex.text);
      const out = run('original', ex.text);
      expect(out.text).toBe(ex.text);
      expect(sameFacts(out.facts, m.facts)).toBe(true);
      expect(sameFacts(out.facts, parseModel(out.text).facts)).toBe(true);
    });
  }
});

describe('FA-21 original without layout', () => {
  for (const ex of examples) {
    for (const keep of [false, true]) {
      it(`${ex.name} (keepSilentMarkers=${String(keep)}): reported facts equal parseModel of the result`, () => {
        const out = run('original-no-layout', ex.text, { keepSilentMarkers: keep });
        const again = parseModel(out.text);
        expect(sameFacts(out.facts, again.facts)).toBe(true);
        expect(again.layout).toEqual([]);
        expect(again.layoutRanges).toEqual([]);
        expect(again.notices.filter((n) => n.kind === 'dropped-dependent')).toEqual([]);
        if (!keep) expect(again.toolRanges).toEqual([]);
        expect(out.text.length).toBeLessThanOrEqual(ex.text.length);
      });
    }
  }

  it('BPMN: the result equals the source minus the diagram', () => {
    const text = bpmn('<process id="p"><task id="t"/></process>\n  <bpmndi:BPMNDiagram id="d">\n    <bpmndi:BPMNPlane id="pl" bpmnElement="p"/>\n  </bpmndi:BPMNDiagram>\n');
    const out = run('original-no-layout', text);
    expect(out.text).not.toContain('BPMNDiagram');
    expect(out.text).toBe(text.replace(/ {2}<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>\n/, ''));
  });

  it('PNML: removing the silent marker makes the transition visible; the option keeps it', () => {
    const text = readFileSync(new URL('pnml/pm4py-dialect.pnml', root), 'utf8');
    const m = parseModel(text);
    expect(m.facts.some((f) => f.category === 'silentTransition')).toBe(true);
    const dropped = run('original-no-layout', text);
    expect(dropped.facts.some((f) => f.category === 'silentTransition')).toBe(false);
    expect(parseModel(dropped.text).facts.some((f) => f.category === 'silentTransition')).toBe(false);
    const kept = run('original-no-layout', text, { keepSilentMarkers: true });
    expect(kept.facts.filter((f) => f.category === 'silentTransition')).toHaveLength(2);
    expect(kept.text).toContain('$invisible$');
  });

  it('PNML: removes graphics and unrelated toolspecific elements, keeps everything else byte for byte', () => {
    const text = pnml('<place id="p">\n      <name><text>a</text></name>\n      <graphics><position x="1" y="2"/></graphics>\n      <toolspecific tool="x" version="1"><k/></toolspecific>\n    </place>');
    const out = run('original-no-layout', text);
    expect(out.text).toBe(text.replace(/ {6}<graphics>.*\n/, '').replace(/ {6}<toolspecific[\s\S]*?<\/toolspecific>\n/, ''));
    expect(out.text).not.toContain('graphics');
    expect(out.text).not.toContain('toolspecific');
  });

  it('spans point at the element text after cutting', () => {
    const text = readFileSync(new URL('pnml/wf-sound.pnml', root), 'utf8');
    const out = run('original-no-layout', text);
    expect(out.spans.length).toBeGreaterThan(0);
    for (const s of out.spans) {
      expect(s.start).toBeLessThan(s.end);
      expect(out.text.slice(s.start, s.start + 1)).toBe('<');
      expect(out.text.slice(s.end - 1, s.end)).toBe('>');
    }
  });
});

describe('cutRanges white space rules', () => {
  const cut = (t: string, r: [number, number][]) => cutRanges(t, r.map(([start, end]) => ({ start, end }))).text;
  it('removes the whole line when the range is alone on it', () => {
    expect(cut('a\n  XX  \nb\n', [[4, 6]])).toBe('a\nb\n');
    expect(cut('a\r\n  XX\r\nb', [[5, 7]])).toBe('a\r\nb');
  });
  it('removes exactly the range when other text shares the line', () => {
    expect(cut('<a>XX</a>\n', [[3, 5]])).toBe('<a></a>\n');
  });
  it('merges nested and adjacent ranges and keeps existing blank lines', () => {
    expect(cut('a\n\n  XXYY\n\nb', [[5, 7], [7, 9], [6, 8]])).toBe('a\n\n\nb');
  });
  it('maps offsets', () => {
    const r = cutRanges('a\n  XX\nb', [{ start: 4, end: 6 }]);
    expect(r.map(0)).toBe(0);
    expect(r.map(7)).toBe(2);
  });
});

describe('option validation', () => {
  it('rejects unknown keys and wrong types, fills defaults', () => {
    const specs = originalNoLayoutGenerator.options;
    expect(resolveOptions(specs)).toEqual({ keepSilentMarkers: false });
    expect(() => resolveOptions(specs, { nope: true })).toThrow(/Unknown option/);
    expect(() => resolveOptions(specs, { keepSilentMarkers: 'yes' })).toThrow(/boolean/);
  });
});
