import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError, detectFormat, parseModel } from '../src/index.js';
import { allFacts, bpmn, pnml } from './helpers.js';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('FA-04: unsupported elements are counted, the rest is read', () => {
  it('BPMN: names count, type and id of every element that is not modelled', () => {
    const model = parseModel(fixture('unsupported-elements.bpmn'));
    const summary = model.notices.map((n) => [n.kind, n.type, n.count, n.items.map((i) => i.id)]);
    expect(summary).toEqual([
      ['unsupported-element', 'message', 1, ['msg1']],
      ['unsupported-attribute', 'process@isExecutable', 1, ['p']],
      ['extension', '@priority', 1, ['t1']],
      ['unsupported-element', 'documentation', 1, [undefined]],
      ['unsupported-element', 'multiInstanceLoopCharacteristics', 1, ['mi']],
      ['unsupported-element', 'loopCardinality', 1, [undefined]],
      ['extension', 'meta', 1, [undefined]],
      ['unsupported-element', 'boundaryEvent', 2, ['b1', 'b2']],
      ['unsupported-element', 'timerEventDefinition', 1, [undefined]],
      ['unsupported-element', 'errorEventDefinition', 1, [undefined]],
      ['unsupported-element', 'callActivity', 1, ['ca']],
      ['unsupported-element', 'eventSubProcess', 1, ['evsp']],
      ['unsupported-element', 'startEvent', 1, ['evs']],
      ['extension', 'foo', 1, ['x1']],
      ['dropped-dependent', 'sequenceFlow', 1, ['f3']],
      ['dropped-dependent', 'BPMNShape', 1, ['b1_di']],
    ]);
    expect(model.notices.find((n) => n.type === 'boundaryEvent')?.items.map((i) => i.line)).toEqual([16, 17]);
    expect(model.notices.find((n) => n.type === 'meta')?.namespace).toBe('urn:vendor:ext');
    // The remainder of the model is still read.
    expect(allFacts(model)).toEqual(
      expect.arrayContaining(['nodeType|t1||task', 'sequenceFlow|["s","t1"]||', 'sequenceFlow|["t1","e"]||', 'layout|s|bounds|5,6,36,36']),
    );
    expect(allFacts(model).some((f) => f.includes('"b1"'))).toBe(false);
  });

  it('PNML: names reference nodes, arc types, further nets and tool data', () => {
    const model = parseModel(fixture('unsupported-elements.pnml'));
    const summary = model.notices.map((n) => [n.kind, n.type, n.count, n.items.map((i) => i.id)]);
    expect(summary).toEqual([
      ['extension', 'toolspecific', 1, [undefined]],
      ['unsupported-element', 'referencePlace', 1, ['rp1']],
      ['unsupported-element', 'arc', 1, ['a3']],
      ['unsupported-element', 'net', 1, ['n2']],
      ['unsupported-element', 'page', 1, ['pg2']],
      ['unsupported-element', 'place', 1, ['q1']],
      ['dropped-dependent', 'arc', 1, ['a4']],
    ]);
    expect(model.notices[2]?.items[0]?.detail).toContain('inhibitor');
    const facts = allFacts(model);
    expect(facts).toEqual(
      expect.arrayContaining(['place|p1||', 'initialMarking|p1||1', 'arc|["p1","t1"]||', 'arcWeight|["t1","p2"]||2', 'silentTransition|t2||']),
    );
    expect(facts.filter((f) => f.startsWith('arc|'))).toHaveLength(3);
  });

  it('counts several elements of one type in one notice', () => {
    const model = parseModel(bpmn(`<process id="p"><task id="a"/><callActivity id="c1"/><callActivity id="c2"/><callActivity/></process>`));
    expect(model.notices).toMatchObject([{ type: 'callActivity', count: 3 }]);
    expect(model.notices[0]?.items.map((i) => i.id)).toEqual(['c1', 'c2', undefined]);
  });

  it('reports non-default attributes whose meaning is not carried', () => {
    const model = parseModel(bpmn(`<process id="p"><exclusiveGateway id="g" gatewayDirection="Diverging"/>
      <task id="t" isForCompensation="true"/><task id="u" startQuantity="1"/></process>`));
    expect(model.notices.map((n) => [n.type, n.items[0]?.detail])).toEqual([
      ['exclusiveGateway@gatewayDirection', 'Diverging'],
      ['task@isForCompensation', 'true'],
    ]);
  });
});

describe('FA-04: unreadable input gives an error with line and cause', () => {
  it('reports the line and cause of a not well-formed file', () => {
    let error: unknown;
    try {
      parseModel(fixture('not-wellformed.bpmn'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    const e = error as ParseError;
    expect(e.code).toBe('not-wellformed');
    expect(e.line).toBe(6);
    expect(e.message).toContain('line 6');
    expect(e.message).toContain('unexpected close tag');
  });

  it('reports an unterminated document at its end', () => {
    expect(() => parseModel('<pnml>\n<net>\n')).toThrow(ParseError);
  });

  it('counts \\r\\n as one line break', () => {
    const text = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">\r\n<process>\r\n</oops>\r\n</definitions>';
    try {
      parseModel(text);
      expect.unreachable();
    } catch (e) {
      expect((e as ParseError).line).toBe(3);
    }
  });

  it('rejects an unsupported net type with its cause', () => {
    const text = pnml('<place id="p"/>', 'http://www.pnml.org/version-2009/grammar/symmetricnet');
    expect(() => parseModel(text)).toThrow(/symmetricnet.*not supported/);
  });

  it('rejects invalid numbers instead of guessing', () => {
    expect(() => parseModel(pnml('<place id="p"><initialMarking><text>-1</text></initialMarking></place>'))).toThrow(/initial marking/);
    expect(() => parseModel(pnml('<place id="p"/><transition id="t"/><arc id="a" source="p" target="t"><inscription><text>0</text></inscription></arc>'))).toThrow(/arc weight/);
  });
});

describe('FA-01: format detection from the content', () => {
  it('detects BPMN', () => {
    expect(detectFormat(bpmn('<process id="p"/>'))).toEqual({ ok: true, format: 'bpmn' });
  });

  it('detects PNML, independent of any file name', () => {
    expect(detectFormat(pnml('<place id="p"/>'))).toEqual({ ok: true, format: 'pnml' });
  });

  it('detects BPMN with a BOM and a prefixed namespace', () => {
    const text = '\uFEFF<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p"/></bpmn:definitions>';
    expect(detectFormat(text)).toEqual({ ok: true, format: 'bpmn' });
    expect(parseModel(text).formalism).toBe('bpmn');
  });

  it('rejects well-formed XML of another kind with the cause', () => {
    const r = detectFormat('<html><body/></html>');
    expect(r).toMatchObject({ ok: false, code: 'unrecognized-format', line: 1 });
    if (!r.ok) expect(r.message).toContain('<html>');
  });

  it('rejects a definitions element outside the BPMN namespace', () => {
    expect(detectFormat('<definitions xmlns="urn:other"/>')).toMatchObject({ ok: false, code: 'unrecognized-format' });
  });

  it('rejects text that is not XML', () => {
    expect(detectFormat('graph TD; A-->B')).toMatchObject({ ok: false, code: 'not-wellformed', line: 1 });
  });

  it('rejects an empty input', () => {
    expect(detectFormat('  \n')).toMatchObject({ ok: false, code: 'empty' });
    expect(() => parseModel('')).toThrow(ParseError);
  });
});
