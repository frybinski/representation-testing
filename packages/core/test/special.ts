import { readdirSync, readFileSync } from 'node:fs';
import { parseModel, type ProcessModel } from '../src/index.js';
import { bpmn, pnml } from './helpers.js';

export interface Case {
  name: string;
  formalism: 'bpmn' | 'pnml';
  text: string;
}

const root = new URL('../../../examples/', import.meta.url);
export const exampleCases: Case[] = (['bpmn', 'pnml'] as const).flatMap((d) =>
  readdirSync(new URL(`${d}/`, root))
    .filter((f) => f.endsWith(`.${d}`))
    .sort()
    .map((f) => ({ name: `examples/${d}/${f}`, formalism: d, text: readFileSync(new URL(`${d}/${f}`, root), 'utf8') })),
);

/** Escapes for XML text and attribute values; line breaks and tabs become character references so they survive. */
export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');

/** Labels that stress quoting, brackets, separators, line breaks, white space and non-ASCII text. */
export const WEIRD_LABELS = [
  'He said "hi"',
  "it's",
  '(a) [b] {c}',
  'line1\nline2',
  '  lead and trail  ',
  '<b>&amp; #35; &lt;',
  'a|b --> c ==> d -.-> e',
  'ünï – 日本語 😀',
  ' ',
  '\ttab',
  'end',
  'class',
  '%% not a comment',
  '`code` $x$ :::',
  'back\\slash',
  '[*] ; a;b ="x" @5 *3 >',
  '#quot; #35;',
  '</b><br/>',
];

/** Ids that are not directly usable as Mermaid ids or as bare identifiers of the compact notation. */
export const WEIRD_IDS = [
  'end', 'End', 'class', 'graph', 'subgraph', 'direction', 'style', 'default', 'click',
  'a-b', 'x.y', 'ünï', '1abc', '_x', 'a__b', 'e__x', 'with space', 'q"uote', 'x:y', '[x]', 'o', 'x', 'anon_task_1', 'A', 'a',
];

const names = (list: string[], i: number): string => list[i % list.length] as string;

function bpmnLabels(): string {
  const tasks = WEIRD_LABELS.map((l, i) => `<task id="t${String(i)}" name="${esc(l)}"/>`).join('\n');
  const flows = WEIRD_LABELS.map((_l, i) => {
    const target = `t${String((i + 1) % WEIRD_LABELS.length)}`;
    const name = names(WEIRD_LABELS, WEIRD_LABELS.length - 1 - i);
    return `<sequenceFlow id="f${String(i)}" name="${esc(name)}" sourceRef="t${String(i)}" targetRef="${target}"><conditionExpression>${esc(name)}</conditionExpression></sequenceFlow>`;
  }).join('\n');
  return bpmn(`<process id="p" name="${esc(WEIRD_LABELS[0] as string)}">\n${tasks}\n${flows}\n</process>`);
}

function bpmnIds(): string {
  const tasks = WEIRD_IDS.map((id) => `<task id="${esc(id)}" name="${esc(id)}"/>`).join('\n');
  const flows = WEIRD_IDS.map((id, i) => `<sequenceFlow id="${esc(`${id}|flow`)}" sourceRef="${esc(id)}" targetRef="${esc(names(WEIRD_IDS, i + 1))}"/>`).join('\n');
  return bpmn(`<process id="p">\n${tasks}\n${flows}\n</process>`);
}

function bpmnStructure(): string {
  return bpmn(`<collaboration id="c">
  <participant id="pa" name="Pool &quot;A&quot;" processRef="p"/>
  <participant id="pb" name="" />
  <messageFlow id="m1" name="msg (1)" sourceRef="send" targetRef="pb"/>
  <messageFlow sourceRef="send" targetRef="pb"/>
</collaboration>
<process id="p" name="">
  <laneSet id="ls"><lane id="l1" name="Lane"><flowNodeRef>a</flowNodeRef></lane></laneSet>
  <startEvent id="s"><timerEventDefinition/><messageEventDefinition/></startEvent>
  <task name="no id"/>
  <task/>
  <task id="a" name=""/>
  <task id="b" name=" "/>
  <sendTask id="send" name="send"/>
  <exclusiveGateway id="x" default="fd"/>
  <parallelGateway name="par"/>
  <inclusiveGateway/>
  <eventBasedGateway id="eb"/>
  <intermediateCatchEvent id="ic" name="wait"><timerEventDefinition/></intermediateCatchEvent>
  <intermediateThrowEvent id="it"/>
  <endEvent id="e" name="end"/>
  <subProcess id="sub" name="outer"><subProcess id="sub2" name="inner"><task id="deep" name="deep"/><task/></subProcess><task id="mid"/>
    <sequenceFlow sourceRef="mid" targetRef="sub2"/></subProcess>
  <dataObjectReference id="dr" name="Data (ref)" dataObjectRef="d"/>
  <dataObject id="d" name="Data"/>
  <dataObject id="d2"/>
  <textAnnotation id="n"><text>Note: "quoted"&#10;second line</text></textAnnotation>
  <textAnnotation><text></text></textAnnotation>
  <association sourceRef="a" targetRef="n"/>
  <task id="rd"><dataInputAssociation><sourceRef>dr</sourceRef></dataInputAssociation><dataOutputAssociation><targetRef>d2</targetRef></dataOutputAssociation></task>
  <sequenceFlow id="q1" sourceRef="s" targetRef="a"/>
  <sequenceFlow id="q2" sourceRef="s" targetRef="a"/>
  <sequenceFlow sourceRef="s" targetRef="a" name="third"/>
  <sequenceFlow sourceRef="a" targetRef="s"/>
  <sequenceFlow id="fd" name="otherwise" sourceRef="x" targetRef="e"/>
  <sequenceFlow sourceRef="x" targetRef="e"><conditionExpression>  x &gt; 1  </conditionExpression></sequenceFlow>
  <sequenceFlow sourceRef="b" targetRef="ic"/>
  <sequenceFlow sourceRef="it" targetRef="eb"/>
</process>`);
}

/** Edges of different type between the same two nodes share one edge key (documented in docs/model.md); regression case. */
function bpmnMixedEdgeTypes(): string {
  return bpmn(`<collaboration id="c">
  <participant id="pa" name="A" processRef="p"/>
  <messageFlow id="m1" name="note" sourceRef="a" targetRef="b"/>
  <messageFlow sourceRef="a" targetRef="b"/>
</collaboration>
<process id="p">
  <task id="a" name="first"/>
  <task id="b" name="second"/>
  <sequenceFlow id="s1" name="go" sourceRef="a" targetRef="b"/>
  <sequenceFlow sourceRef="a" targetRef="b"/>
</process>`);
}

const pn = (id: string, label: string, kind: 'place' | 'transition', extra = ''): string =>
  `<${kind} id="${esc(id)}"><name><text>${esc(label)}</text></name>${extra}</${kind}>`;

function pnmlLabels(): string {
  const body = WEIRD_LABELS.map((l, i) => (i % 2 === 0 ? pn(`n${String(i)}`, l, 'place') : pn(`n${String(i)}`, l, 'transition'))).join('\n');
  const arcs = WEIRD_LABELS.map((l, i) => {
    const j = (i + 1) % WEIRD_LABELS.length;
    return `<arc id="a${String(i)}" source="n${String(i)}" target="n${String(j)}"><name><text>${esc(l)}</text></name>${i % 3 === 0 ? `<inscription><text>${String(i + 2)}</text></inscription>` : ''}</arc>`;
  }).join('\n');
  return pnml(`${body}\n${arcs}`);
}

function pnmlIds(): string {
  const ids = WEIRD_IDS.slice(0, 24);
  const body = ids.map((id, i) => pn(id, id, i % 2 === 0 ? 'place' : 'transition')).join('\n');
  const arcs = ids.map((id, i) => `<arc id="${esc(`${id}|arc`)}" source="${esc(id)}" target="${esc(names(ids, i + 1))}"/>`).join('\n');
  return pnml(`${body}\n${arcs}`);
}

function pnmlStructure(): string {
  return pnml(`<page id="pg1">
  <place id="p1"><initialMarking><text>3</text></initialMarking></place>
  <place id="p2"/>
  <place id="p3"><name><text/></name></place>
  <page id="inner"><transition id="t1"><name><text>visible</text></name></transition>
    <transition id="t2"><toolspecific tool="ProM" version="6.4" activity="$invisible$"/></transition>
    <transition id="t3"><toolspecific tool="other"><x/></toolspecific></transition>
  </page>
</page>
<arc id="x1" source="p1" target="t1"/>
<arc id="x2" source="p1" target="t1"><inscription><text>2</text></inscription></arc>
<arc source="t1" target="p2"/>
<arc source="t1" target="p2"/>
<arc id="x3" source="p2" target="t2"><inscription><text>1</text></inscription></arc>
<arc source="t2" target="p3"><name><text>to p3</text></name></arc>
<arc source="p3" target="t3"/>
<arc source="t3" target="p1"/>
<finalmarkings>
  <marking><place idref="p2"><text>1</text></place></marking>
  <marking><place idref="p3"><text>2</text></place><place idref="p1"><text>1</text></place></marking>
  <marking></marking>
</finalmarkings>`);
}

function pnmlOneFinal(): string {
  return pnml(`<place id="a"/><place id="b"/><transition id="t"/>
<arc source="a" target="t"/><arc source="t" target="b"/>
<finalmarkings><marking><place idref="b"><text>1</text></place></marking></finalmarkings>`);
}

export const specialCases: Case[] = [
  { name: 'bpmn: awkward labels, flow names and conditions', formalism: 'bpmn', text: bpmnLabels() },
  { name: 'bpmn: awkward ids', formalism: 'bpmn', text: bpmnIds() },
  { name: 'bpmn: structure (no ids, parallel flows, nesting, data, lanes)', formalism: 'bpmn', text: bpmnStructure() },
  { name: 'pnml: awkward labels and arc names', formalism: 'pnml', text: pnmlLabels() },
  { name: 'pnml: awkward ids', formalism: 'pnml', text: pnmlIds() },
  { name: 'pnml: pages, parallel arcs, weights, several final markings, silent', formalism: 'pnml', text: pnmlStructure() },
  { name: 'pnml: one final marking and all weights 1', formalism: 'pnml', text: pnmlOneFinal() },
  { name: 'bpmn: sequence flow and message flow between the same two nodes', formalism: 'bpmn', text: bpmnMixedEdgeTypes() },
];

export const allCases: Case[] = [...exampleCases, ...specialCases];

export const modelOf = (c: Case): ProcessModel => parseModel(c.text);
