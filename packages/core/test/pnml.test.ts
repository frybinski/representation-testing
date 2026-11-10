import { describe, expect, it } from 'vitest';
import { parseModel } from '../src/index.js';
import { allFacts, factsOf, pnml } from './helpers.js';

const read = (body: string) => parseModel(pnml(body));

describe('PNML parser: place/transition nets (FA-03)', () => {
  it('reads places, transitions, arcs and the identifier facts', () => {
    const m = read(`<page id="pg"><place id="p1"/><transition id="t1"/><place id="p2"/>
      <arc id="a1" source="p1" target="t1"/><arc id="a2" source="t1" target="p2"/></page>`);
    expect(m.formalism).toBe('pnml');
    expect(m.notices).toEqual([]);
    expect(factsOf(m, 'place')).toEqual(['place|p1||', 'place|p2||']);
    expect(factsOf(m, 'transition')).toEqual(['transition|t1||']);
    expect(factsOf(m, 'arc')).toEqual(['arc|["p1","t1"]||', 'arc|["t1","p2"]||']);
    expect(factsOf(m, 'identifier')).toContain('identifier|["p1","t1"]||a1');
  });

  it('reads names as label facts', () => {
    const m = read(`<place id="p1"><name><text>Start</text></name></place>
      <transition id="t1"><name><text>Do it</text></name></transition>`);
    expect(factsOf(m, 'label')).toEqual(['label|p1||Start', 'label|t1||Do it']);
  });

  it('reads arc weights; weight 1 gives no fact', () => {
    const m = read(`<place id="p"/><transition id="t"/>
      <arc id="a" source="p" target="t"><inscription><text>3</text></inscription></arc>
      <arc id="b" source="t" target="p"><inscription><text>1</text></inscription></arc>`);
    expect(factsOf(m, 'arcWeight')).toEqual(['arcWeight|["p","t"]||3']);
  });

  it('reads the initial marking; 0 gives no fact', () => {
    const m = read(`<place id="p"><initialMarking><text>2</text></initialMarking></place>
      <place id="q"><initialMarking><text>0</text></initialMarking></place>`);
    expect(factsOf(m, 'initialMarking')).toEqual(['initialMarking|p||2']);
  });

  it('reads the ptnet initial marking written with a "Default,n" style text only as a plain number', () => {
    expect(() => read(`<place id="p"><initialMarking><text>Default,1</text></initialMarking></place>`)).toThrow(/initial marking/);
  });

  it('reads nested pages in document order', () => {
    const m = read(`<page id="outer"><place id="p1"/>
        <page id="inner"><transition id="t1"/></page>
      </page><place id="p2"/>
      <arc id="a" source="p1" target="t1"/>`);
    expect(m.notices).toEqual([]);
    expect(factsOf(m, 'place')).toEqual(['place|p1||', 'place|p2||']);
    expect(factsOf(m, 'transition')).toEqual(['transition|t1||']);
    expect(factsOf(m, 'arc')).toEqual(['arc|["p1","t1"]||']);
  });

  it('reads a net without any page', () => {
    const m = read(`<place id="p"/>`);
    expect(factsOf(m, 'place')).toEqual(['place|p||']);
  });

  it('accepts the ptnet net type and an absent type', () => {
    expect(parseModel(pnml('<place id="p"/>', 'http://www.pnml.org/version-2009/grammar/ptnet')).notices).toEqual([]);
    expect(parseModel('<pnml><net id="n"><place id="p"/></net></pnml>').facts.length).toBeGreaterThan(0);
  });

  it('keeps parallel arcs apart by occurrence', () => {
    const m = read(`<place id="p"/><transition id="t"/>
      <arc id="a" source="p" target="t"/><arc id="b" source="p" target="t"/>`);
    expect(factsOf(m, 'arc')).toEqual(['arc|["p","t"]||', 'arc|["p","t",2]||']);
  });

  it('rejects an arc between two places', () => {
    expect(() => read(`<place id="p"/><place id="q"/><arc id="a" source="p" target="q"/>`)).toThrow(/place|transition/);
  });

  it('rejects an arc to an unknown node and duplicate ids', () => {
    expect(() => read(`<place id="p"/><arc id="a" source="p" target="zz"/>`)).toThrow(/zz/);
    expect(() => read(`<place id="p"/><transition id="p"/>`)).toThrow(/duplicate/i);
  });

  it('synthesises ids deterministically for elements without id (no identifier fact)', () => {
    const m = read(`<place/><transition/><place/>`);
    expect(factsOf(m, 'place')).toEqual(['place|anon_place_1||', 'place|anon_place_2||']);
    expect(factsOf(m, 'identifier')).toEqual(['identifier|net1||net1']);
    expect(allFacts(m)).toEqual(allFacts(read(`<place/><transition/><place/>`)));
  });
});

describe('PNML parser: graphics as layout facts (FA-50)', () => {
  it('reads node position, dimension, fill and line', () => {
    const m = read(`<place id="p"><graphics><position x="10" y="20.5"/><dimension x="40" y="40"/>
      <fill color="#ffffff"/><line color="#000000" width="2"/></graphics></place>`);
    expect(factsOf(m, 'layout')).toEqual([
      'layout|p|dimension|40,40',
      'layout|p|fill|color=#ffffff',
      'layout|p|line|color=#000000;width=2',
      'layout|p|position|10,20.5',
    ]);
    expect(m.layoutRanges.length).toBe(1);
  });

  it('reads arc waypoints', () => {
    const m = read(`<place id="p"/><transition id="t"/>
      <arc id="a" source="p" target="t"><graphics><position x="1" y="2"/><position x="3" y="4"/></graphics></arc>`);
    expect(factsOf(m, 'layout')).toEqual(['layout|["p","t"]|waypoints|1,2;3,4']);
  });

  it('reads annotation graphics of names', () => {
    const m = read(`<place id="p"><name><text>x</text><graphics><offset x="-5" y="7"/></graphics></name></place>`);
    expect(factsOf(m, 'layout')).toEqual(['layout|p|name.offset|-5,7']);
  });

  it('reads page graphics', () => {
    const m = read(`<page id="pg"><graphics><position x="0" y="0"/></graphics><place id="p"/></page>`);
    expect(factsOf(m, 'layout')).toEqual(['layout|pg|position|0,0']);
  });
});

describe('PNML parser: pm4py dialect', () => {
  const dialect = `<?xml version="1.0" encoding="UTF-8"?>
<pnml>
  <net id="net1" type="http://www.pnml.org/version-2009/grammar/pnmlcoremodel">
    <name><text>net1</text></name>
    <page id="n0">
      <place id="source"><name><text>source</text></name><initialMarking><text>1</text></initialMarking></place>
      <place id="sink"><name><text>sink</text></name></place>
      <transition id="skip"><name><text>skip</text></name>
        <toolspecific tool="ProM" version="6.4" activity="$invisible$" localNodeID="1b3a"/></transition>
      <transition id="a"><name><text>a</text></name></transition>
      <arc id="-1234" source="source" target="a"/>
      <arc id="-5678" source="a" target="sink"/>
      <arc id="-9" source="source" target="skip"/>
    </page>
    <finalmarkings><marking><place idref="sink"><text>1</text></place></marking></finalmarkings>
  </net>
</pnml>`;

  it('reads the final marking and silent transitions without a notice', () => {
    const m = parseModel(dialect);
    expect(m.notices).toEqual([]);
    expect(factsOf(m, 'finalMarking')).toEqual(['finalMarking|sink||1']);
    expect(factsOf(m, 'silentTransition')).toEqual(['silentTransition|skip||']);
    expect(factsOf(m, 'initialMarking')).toEqual(['initialMarking|source||1']);
    expect(factsOf(m, 'transition')).toEqual(['transition|skip||', 'transition|a||']);
  });

  it('keeps several final markings apart (facts follow place order, aspect names the marking)', () => {
    const text = dialect.replace(
      '</finalmarkings>',
      '<marking><place idref="source"><text>1</text></place></marking></finalmarkings>',
    );
    expect(factsOf(parseModel(text), 'finalMarking')).toEqual(['finalMarking|source|m2|1', 'finalMarking|sink|m1|1']);
  });

  it('rejects a final marking naming an unknown place', () => {
    expect(() => parseModel(dialect.replace('idref="sink"', 'idref="nope"'))).toThrow(/nope/);
  });
});
