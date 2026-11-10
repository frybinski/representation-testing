import { describe, expect, it } from 'vitest';
import { diffFacts, parseModel, verbalizationGenerator, type Fact, type ModelEdge, type ModelNode, type OptionValues, type ProcessModel, type TextOutput } from '../src/index.js';
import { checkOutput } from './check.js';
import { allCases, exampleCases, modelOf } from './special.js';

const run = (model: ReturnType<typeof modelOf>, options: OptionValues): TextOutput => {
  const out = verbalizationGenerator.generate(model, options);
  if (out.kind !== 'text') throw new Error('text expected');
  return out;
};

const optionSets: OptionValues[] = [
  { language: 'en', showIdentifiers: false },
  { language: 'en', showIdentifiers: true },
  { language: 'de', showIdentifiers: false },
  { language: 'de', showIdentifiers: true },
];

const QUOTED = new Set(['label', 'identifier', 'sequenceFlowName', 'condition']);
const RAW = new Set(['eventType', 'arcWeight', 'initialMarking', 'finalMarking']);

/** The literal value of a value-bearing fact must stand in the sentence that is mapped to it. */
function valueIsStated(f: Fact, spanText: string): boolean {
  if (QUOTED.has(f.category)) return spanText.includes(JSON.stringify(f.value));
  if (f.category === 'annotation' && f.aspect === 'text') return spanText.includes(JSON.stringify(f.value));
  if (RAW.has(f.category)) return spanText.includes(f.value);
  return true;
}

describe('verbalization (FA-25)', () => {
  for (const options of optionSets) {
    describe(JSON.stringify(options), () => {
      for (const c of allCases) {
        it(c.name, () => {
          const model = modelOf(c);
          const out = run(model, options);
          checkOutput(out, new Set(model.facts.map((f) => f.id)));
          const byId = new Map(out.facts.map((f) => [f.id, f]));
          for (const span of out.spans) {
            const stretch = out.text.slice(span.start, span.end);
            expect(stretch.endsWith('.')).toBe(true);
            for (const id of span.factIds) {
              const f = byId.get(id);
              expect(f && valueIsStated(f, stretch), `${id} in "${stretch}"`).toBe(true);
            }
          }
          const hasIdentifiers = out.facts.some((f) => f.category === 'identifier');
          if (options.showIdentifiers === false) expect(hasIdentifiers).toBe(false);
          // Determinism (R-5).
          expect(run(modelOf(c), options)).toEqual(out);
        });
      }
    });
  }

  it('tells the languages apart and keeps the same carried facts in both', () => {
    for (const c of exampleCases) {
      const model = modelOf(c);
      const en = run(model, { language: 'en', showIdentifiers: true });
      const de = run(model, { language: 'de', showIdentifiers: true });
      expect(en.text).toContain('There is ');
      expect(de.text).toContain('Es gibt ');
      expect(diffFacts(en.facts, de.facts)).toEqual([]);
      expect(diffFacts(de.facts, en.facts)).toEqual([]);
    }
  });

  it('states every Petri net fact except layout and net/page facts', () => {
    for (const c of exampleCases.filter((x) => x.formalism === 'pnml')) {
      const model = modelOf(c);
      const out = run(model, { language: 'en', showIdentifiers: true });
      const missing = diffFacts(model.facts, out.facts).filter((f) => f.category !== 'layout' && !['net', 'page'].includes(model.nodes.find((n) => n.id === f.subject)?.type ?? ''));
      expect(missing, c.name).toEqual([]);
    }
  });

  it('introduces an alias for unnamed or duplicate names and uses it afterwards', () => {
    const out = run(
      parseModel(`<?xml version="1.0"?><pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="pg">
        <place id="p1"><name><text>dup</text></name></place><place id="p2"><name><text>dup</text></name></place><transition id="t"/>
        <arc id="a1" source="p1" target="t"/><arc id="a2" source="t" target="p2"><inscription><text>3</text></inscription></arc></page></net></pnml>`),
      { language: 'en', showIdentifiers: false },
    );
    expect(out.text).toContain('There is a place named "dup", referred to below as place 1.');
    expect(out.text).toContain('its outgoing arcs lead to place 2 (weight 3).');
    expect(out.text).toContain('There is a transition without a name, referred to below as transition 1.');
  });

  it('does not mention an element id when identifiers are off, and does when they are on', () => {
    const model = modelOf(exampleCases.filter((x) => x.formalism === 'pnml')[0] as (typeof exampleCases)[number]);
    const id = model.nodes.find((n) => n.type === 'place' && n.idExplicit)?.id ?? '';
    expect(run(model, { language: 'en', showIdentifiers: false }).text).not.toContain(`identifier ${JSON.stringify(id)}`);
    expect(run(model, { language: 'en', showIdentifiers: true }).text).toContain(`identifier ${JSON.stringify(id)}`);
  });
});

/**
 * Relational facts are checked against the neighbour the sentence names. The text is read independently of the generator:
 * line i is the i-th described node (the generator writes one line per node in model order), and the reference of a node
 * is its alias if its own line introduces one, otherwise its quoted name.
 */
interface Reading {
  described: ModelNode[];
  lines: string[];
  lineStart: number[];
  ref: (id: string) => string;
  lineOf: (id: string) => number;
}

function readText(model: ProcessModel, out: TextOutput, lang: 'en' | 'de'): Reading {
  const described = model.nodes.filter((n) => (model.formalism === 'pnml' ? n.type === 'place' || n.type === 'transition' : n.type !== 'collaboration'));
  const lines = out.text.split('\n');
  expect(lines.length - 1).toBe(described.length);
  const lineStart: number[] = [];
  let at = 0;
  for (const l of lines) {
    lineStart.push(at);
    at += l.length + 1;
  }
  const aliasRe = lang === 'en' ? /, referred to below as ([^,.]+)/ : /, im Folgenden ([^,.]+) genannt/;
  const refs = new Map<string, string>();
  described.forEach((n, i) => {
    const alias = aliasRe.exec(lines[i] ?? '')?.[1];
    refs.set(n.id, alias ?? JSON.stringify(n.name));
  });
  return {
    described,
    lines,
    lineStart,
    ref: (id) => refs.get(id) ?? `<<undescribed ${id}>>`,
    lineOf: (id) => described.findIndex((n) => n.id === id),
  };
}

/** The stretch of the sentence between a clause opener and the next `;` or the end (without the final period). */
function clauseOf(sentence: string, opener: RegExp): string | undefined {
  const m = opener.exec(sentence);
  if (!m) return undefined;
  const rest = sentence.slice(m.index + m[0].length);
  const stop = rest.search(/; /);
  return (stop < 0 ? rest : rest.slice(0, stop)).replace(/\.$/, '');
}

const edgeOf = (model: ProcessModel, f: Fact): ModelEdge | undefined => model.edges.find((e) => e.key === f.subject);

describe('verbalization states the right neighbours (relational facts)', () => {
  for (const lang of ['en', 'de'] as const) {
    for (const c of allCases) {
      it(`${lang}: ${c.name}`, () => {
        const model = modelOf(c);
        const out = run(model, { language: lang, showIdentifiers: false });
        const r = readText(model, out, lang);
        const spanOf = (f: Fact) => out.spans.find((sp) => sp.factIds.includes(f.id));
        for (const f of out.facts) {
          let subject: string | undefined;
          let object: string | undefined;
          if (f.category === 'sequenceFlow' || f.category === 'messageFlow' || f.category === 'arc') {
            const e = edgeOf(model, f);
            subject = e?.source;
            object = e?.target;
          } else if (f.category === 'annotation' && f.aspect === 'association') {
            const e = edgeOf(model, f);
            [subject, object] = [e?.source, e?.target];
          } else if (f.category === 'dataObject' && f.aspect === 'association') {
            const e = edgeOf(model, f);
            [subject, object] = f.value === 'input' ? [e?.target, e?.source] : [e?.source, e?.target];
          } else if ((f.aspect === 'parent' || f.aspect === 'member' || f.aspect === 'ref' || f.aspect === 'process') && ['node', 'poolLane', 'dataObject', 'annotation'].includes(f.category)) {
            subject = f.subject;
            object = f.value;
          } else continue;
          if (subject === undefined || object === undefined) throw new Error(`no endpoints for ${f.id}`);
          const span = spanOf(f);
          expect(span, f.id).toBeDefined();
          if (!span) continue;
          const line = r.lineOf(subject);
          // The sentence belongs to the subject's line, and names the object by the reference the object's own line defines.
          expect(span.start >= (r.lineStart[line] ?? -1) && span.end <= (r.lineStart[line] ?? 0) + (r.lines[line] ?? '').length, `${f.id} is on the line of ${subject}`).toBe(true);
          expect(out.text.slice(span.start, span.end), f.id).toContain(r.ref(object));
        }
      });
    }

    it(`${lang}: the neighbours of every node are exactly those of the model (examples)`, () => {
      for (const c of exampleCases) {
        const model = modelOf(c);
        const out = run(model, { language: lang, showIdentifiers: false });
        const r = readText(model, out, lang);
        const opener =
          lang === 'en'
            ? { followed: /it is followed by /i, preceded: /it is preceded by /i, arcsOut: /its outgoing arcs lead to /i, arcsIn: /its incoming arcs come from /i, msgOut: /it sends a message flow to /i, msgIn: /it receives a message flow from /i }
            : { followed: /danach (?:folgt|folgen) /i, preceded: /davor (?:steht|stehen) /i, arcsOut: /(?:seine|ihre) ausgehenden Kanten führen zu /i, arcsIn: /(?:seine|ihre) eingehenden Kanten kommen von /i, msgOut: /(?:er|sie|es) sendet einen Nachrichtenfluss an /i, msgIn: /(?:er|sie|es) empfängt einen Nachrichtenfluss von /i };
        // Names are unique in these examples, or aliased; either way a reference is a quoted name or `word k`.
        for (const n of r.described) {
          const line = r.lines[r.lineOf(n.id)] ?? '';
          const second = line.slice(line.indexOf('. ') + 2);
          const expectRefs = (edges: ModelEdge[], side: 'source' | 'target'): string[] => [...new Set(edges.map((e) => r.ref(e[side])))];
          const isDesc = (id: string): boolean => r.lineOf(id) >= 0;
          const mine = (type: string, end: 'source' | 'target') => model.edges.filter((e) => e.type === type && e[end] === n.id && isDesc(e.source) && isDesc(e.target));
          const checks: [RegExp, string[]][] =
            model.formalism === 'bpmn'
              ? [
                  [opener.followed, expectRefs(mine('sequenceFlow', 'source'), 'target')],
                  [opener.preceded, expectRefs(mine('sequenceFlow', 'target'), 'source')],
                  [opener.msgOut, expectRefs(mine('messageFlow', 'source'), 'target')],
                  [opener.msgIn, expectRefs(mine('messageFlow', 'target'), 'source')],
                ]
              : [
                  [opener.arcsOut, expectRefs(mine('arc', 'source'), 'target')],
                  [opener.arcsIn, expectRefs(mine('arc', 'target'), 'source')],
                ];
          for (const [re, expected] of checks) {
            const clause = clauseOf(second, re);
            if (expected.length === 0) {
              expect(clause, `${n.id} ${String(re)}`).toBeUndefined();
              continue;
            }
            expect(clause, `${n.id} ${String(re)}`).toBeDefined();
            // Every expected reference is in the clause, and every reference of any other node that is not expected is not.
            for (const x of expected) expect(clause).toContain(x);
            for (const other of r.described) {
              const ref = r.ref(other.id);
              if (!expected.includes(ref)) expect(clause, `${n.id}: unexpected ${ref}`).not.toContain(ref);
            }
          }
        }
      }
    });
  }
});

describe('verbalization of processes and German grammar', () => {
  const collab = (): ProcessModel => modelOf(exampleCases.find((c) => c.name.endsWith('collaboration.bpmn')) as (typeof exampleCases)[number]);

  it('names the process of a participant, not its id, unless identifiers are on', () => {
    const model = collab();
    const pool = model.nodes.find((n) => n.type === 'participant' && typeof n.attributes.processRef === 'string');
    expect(pool).toBeDefined();
    const processRef = String(pool?.attributes.processRef);
    const process = model.nodes.find((n) => n.id === processRef);
    expect(process?.name).toBe('Customer');
    for (const lang of ['en', 'de'] as const) {
      const off = run(model, { language: lang, showIdentifiers: false });
      // "Customer" names both the participant and the process, so the process is referred to by its alias.
      expect(off.text).not.toContain(processRef);
      expect(off.text).toContain(lang === 'en' ? 'executing process 1' : 'der den Prozess 1 ausführt');
      const on = run(model, { language: lang, showIdentifiers: true });
      expect(on.text).toContain(JSON.stringify(processRef)); // the id appears only with showIdentifiers
      expect(on.text).not.toContain('executing the process "' + processRef);
      // The fact says which process; the sentence of the pool contains the reference of the process described elsewhere.
      const fact = off.facts.find((f) => f.category === 'poolLane' && f.subject === pool?.id && f.aspect === 'process');
      expect(fact?.value).toBe(processRef);
      expect(off.facts.some((f) => f.category === 'poolLane' && f.subject === processRef && f.aspect === 'kind')).toBe(true);
    }
  });

  it('gives an unnamed process an alias and refers to it by the alias', () => {
    const model = parseModel(`<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="x">
      <collaboration id="c"><participant id="pa" name="P" processRef="p1"/></collaboration><process id="p1"/></definitions>`);
    const out = run(model, { language: 'en', showIdentifiers: false });
    expect(out.text).toContain('There is a process without a name, referred to below as process 1.');
    expect(out.text).toContain('executing process 1');
    expect(out.text).not.toContain('"p1"');
  });

  it('uses the pronoun and possessive that fit the grammatical gender', () => {
    const model = parseModel(`<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="x">
      <collaboration id="c"><participant id="pa" name="Pool" processRef="p"/><participant id="pb" name="Other"/>
        <messageFlow id="m" sourceRef="pa" targetRef="pb"/><messageFlow id="m2" sourceRef="t" targetRef="pb"/></collaboration>
      <process id="p" name="Proc"><userTask id="t" name="T"><dataInputAssociation><sourceRef>d</sourceRef></dataInputAssociation></userTask>
        <dataObjectReference id="d" name="D" dataObjectRef="dd"/><dataObject id="dd" name="DD"/>
        <sendTask id="s" name="S"/><startEvent id="e" name="E"/><sequenceFlow sourceRef="e" targetRef="s"/></process></definitions>`);
    const de = run(model, { language: 'de', showIdentifiers: false }).text;
    expect(de).toContain('Es gibt eine Benutzeraufgabe namens "T"');
    expect(de).toContain('sie liest aus "D"'); // Benutzeraufgabe is feminine
    expect(de).toContain('Sie sendet einen Nachrichtenfluss an "Other"');
    expect(de).toContain('Er sendet einen Nachrichtenfluss an "Other"'); // Teilnehmer is masculine
    expect(de).not.toMatch(/\bEs (liest|sendet|empfängt|schreibt|enthält)\b/);
    expect(de).not.toMatch(/\bes (liest|sendet|empfängt|schreibt|enthält)\b/);
    const pnetDe = run(
      parseModel(`<?xml version="1.0"?><pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="pg">
        <place id="p1"><name><text>P</text></name></place><transition id="t1"><name><text>T</text></name></transition><place id="p2"><name><text>Q</text></name></place>
        <arc source="p1" target="t1"/><arc source="t1" target="p2"/></page></net></pnml>`),
      { language: 'de', showIdentifiers: false },
    ).text;
    expect(pnetDe).toContain('Ihre ausgehenden Kanten führen zu "T"'); // Stelle: feminine
    expect(pnetDe).toContain('Ihre eingehenden Kanten kommen von "P"'); // Transition: feminine
    expect(pnetDe).toContain('ihre ausgehenden Kanten führen zu "Q"');
  });

  it('conjugates German "folgen" and "stehen" with the number of neighbours', () => {
    const model = parseModel(`<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="x">
      <process id="p" name="Proc"><task id="a" name="A"/><task id="b" name="B"/><task id="c" name="C"/>
        <sequenceFlow sourceRef="a" targetRef="b"/><sequenceFlow sourceRef="a" targetRef="c"/><sequenceFlow sourceRef="b" targetRef="c"/></process></definitions>`);
    const de = run(model, { language: 'de', showIdentifiers: false }).text;
    expect(de).toContain('Danach folgen "B" und "C"');
    expect(de).toContain('danach folgt "C"');
    expect(de).toContain('Davor stehen "A" und "B"');
    expect(de).toContain('Davor steht "A"');
    expect(de).not.toContain('folgt "B" und');
    const en = run(model, { language: 'en', showIdentifiers: false }).text;
    expect(en).toContain('It is followed by "B" and "C"');
  });

  it('states parallel flows to the same neighbour once, with their number and details', () => {
    const model = parseModel(`<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="x">
      <process id="p"><task id="a" name="A"/><task id="b" name="B"/>
        <sequenceFlow sourceRef="a" targetRef="b" name="x"/><sequenceFlow sourceRef="a" targetRef="b"/></process></definitions>`);
    const en = run(model, { language: 'en', showIdentifiers: false });
    expect(en.text).toContain('It is followed by "B" (2 flows: (1) flow named "x"; (2) no details).');
    expect(en.text).toContain('It is preceded by "A" (2 flows).');
    expect(en.text).not.toContain('"B" and "B"');
    const de = run(model, { language: 'de', showIdentifiers: false }).text;
    expect(de).toContain('Danach folgt "B" (2 Flüsse: (1) Fluss namens "x"; (2) ohne Angaben).');
    expect(de).toContain('Davor steht "A" (2 Flüsse).');
    // Both flows are still carried: the two edge keys are [a,b] and [a,b,2].
    expect(en.facts.filter((f) => f.category === 'sequenceFlow').map((f) => f.subject)).toEqual([JSON.stringify(['a', 'b']), JSON.stringify(['a', 'b', 2])]);
  });
});
