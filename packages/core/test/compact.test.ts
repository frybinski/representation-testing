import { describe, expect, it } from 'vitest';
import { compactGenerator, compactNotation, GeneratorRegistry, parseModel, sameFacts, type TextOutput } from '../src/index.js';
import { pnml } from './helpers.js';
import { esc, modelOf, specialCases } from './special.js';

const gen = (text: string): TextOutput => {
  const out = compactGenerator.generate(parseModel(text), {});
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

describe('compact notation', () => {
  it('writes the documented format for the structure fixture', () => {
    expect(gen((specialCases[5] as (typeof specialCases)[number]).text).text).toBe(
      'places: p1@3 p2 p3\ntransitions: t1="visible" t2~ t3\narcs: p1>t1 p1>t1*2 t1>p2 t1>p2 p2>t2 t2>p3="to p3" p3>t3 t3>p1\nfinal: p2@1\nfinal: p1@1 p3@2\nfinal:\n',
    );
  });

  it('keeps labels with separators and quotes unambiguous', () => {
    const label = 'a>b "x" =y @3 *2 ~ \n:';
    const out = gen(pnml(`<place id="p"><name><text>${esc(label)}</text></name></place><transition id="t"/><arc source="p" target="t"/>`));
    expect(out.text).toContain(JSON.stringify(label));
    expect(sameFacts(compactNotation.read(out.text, 'pnml'), out.facts)).toBe(true);
    expect(out.facts.some((f) => f.category === 'label' && f.value === label)).toBe(true);
  });

  it('does not report a net without markings or weights as carrying them', () => {
    const out = gen(pnml('<place id="a"/><transition id="t"/><arc source="a" target="t"/>'));
    expect(out.facts.map((f) => f.category).sort()).toEqual(['arc', 'identifier', 'identifier', 'place', 'transition']);
  });

  it('does not report an identifier for an id that looks invented, and reads none', () => {
    const out = gen(pnml('<place id="anon_place_1"/><place id="real"/><transition id="t"/>'));
    expect(out.facts.filter((f) => f.category === 'identifier').map((f) => f.subject)).toEqual(['real', 't']);
  });

  it('is rejected for BPMN and for malformed text', () => {
    expect(() => compactNotation.read('places: p', 'bpmn')).toThrow(/Petri/);
    expect(() => compactNotation.read('nonsense\n', 'pnml')).toThrow(/unknown line/);
    expect(() => compactNotation.read('places: p=oops\n', 'pnml')).toThrow(/syntax/);
    expect(() => compactNotation.read('places: p~\n', 'pnml')).toThrow(/syntax/);
    expect(() => compactNotation.read('transitions: t@1\n', 'pnml')).toThrow(/syntax/);
    expect(() => compactNotation.read('arcs: p>\n', 'pnml')).toThrow(/syntax/);
    expect(() => new GeneratorRegistry().register(compactGenerator).run('compact', modelOf(specialCases[0] as (typeof specialCases)[number]))).toThrow(/does not support/);
  });

  it('accepts and ignores default values when reading', () => {
    const facts = compactNotation.read('places: p@0\ntransitions: t\narcs: p>t*1\nfinal:\n', 'pnml');
    expect(facts.map((f) => f.category)).toEqual(['place', 'identifier', 'transition', 'identifier', 'arc']);
  });
});
