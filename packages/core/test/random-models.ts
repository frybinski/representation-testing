import { bpmn, pnml } from './helpers.js';
import { esc, WEIRD_IDS, WEIRD_LABELS } from './special.js';

/** mulberry32: a small seeded generator; the same seed gives the same sequence on every machine. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)] as T;
  }
}

const PLAIN = ['Check order', 'Ship goods', 'Pay', 'Approve', 'Archive', 'Notify customer', 'Prüfen', 'A'];
const label = (r: Rng): string => (r.chance(0.35) ? r.pick(WEIRD_LABELS) : r.pick(PLAIN));
const ID_POOL = ['n', 'task', 'x', ...WEIRD_IDS];

/** Unique ids: a pool of awkward ids first, numbered ids otherwise. */
function ids(r: Rng, count: number, prefix: string): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let id = r.chance(0.3) ? r.pick(ID_POOL) : `${prefix}${String(i)}`;
    if (used.has(id)) id = `${prefix}${String(i)}_u`;
    used.add(id);
    out.push(id);
  }
  return out;
}

const BPMN_NODES = [
  'task', 'userTask', 'serviceTask', 'sendTask', 'receiveTask', 'scriptTask', 'manualTask', 'businessRuleTask',
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway',
] as const;
const EVENT_DEFS = ['timerEventDefinition', 'messageEventDefinition', 'signalEventDefinition', 'errorEventDefinition', 'terminateEventDefinition'];

/** A small BPMN process, sometimes with a nested subprocess, data objects, annotations, a collaboration and message flows. */
export function randomBpmn(seed: number): string {
  const r = new Rng(seed);
  const n = 2 + r.int(9);
  const nodeIds = ids(r, n, 'n');
  const nodes: string[] = [];
  const flowable: string[] = [];
  nodeIds.forEach((id, i) => {
    const type = r.pick(BPMN_NODES);
    const name = r.chance(0.7) ? ` name="${esc(label(r))}"` : '';
    const idAttr = r.chance(0.9) ? ` id="${esc(id)}"` : '';
    const isEvent = /Event$/.test(type);
    const def = isEvent && type !== 'endEvent' && r.chance(0.5) ? `<${r.pick(EVENT_DEFS)}/>` : '';
    nodes.push(def === '' ? `<${type}${idAttr}${name}/>` : `<${type}${idAttr}${name}>${def}</${type}>`);
    if (idAttr !== '') flowable.push(id);
    else void i;
  });
  let sub = '';
  if (flowable.length >= 2 && r.chance(0.3)) {
    sub = `<subProcess id="sp" name="${esc(label(r))}"><task id="sp_a" name="${esc(label(r))}"/><task id="sp_b"/><sequenceFlow id="sp_f" sourceRef="sp_a" targetRef="sp_b"/></subProcess>`;
    flowable.push('sp');
  }
  const flows: string[] = [];
  const flowCount = flowable.length < 2 ? 0 : r.int(flowable.length * 2);
  for (let i = 0; i < flowCount; i++) {
    const a = r.pick(flowable);
    const b = r.pick(flowable);
    const id = r.chance(0.7) ? ` id="f${String(i)}"` : '';
    const name = r.chance(0.3) ? ` name="${esc(label(r))}"` : '';
    const cond = r.chance(0.2) ? `<conditionExpression>${esc(label(r))}</conditionExpression>` : '';
    flows.push(`<sequenceFlow${id}${name} sourceRef="${esc(a)}" targetRef="${esc(b)}">${cond}</sequenceFlow>`);
  }
  const extras: string[] = [];
  if (r.chance(0.3)) extras.push(`<textAnnotation id="ann"><text>${esc(label(r))}</text></textAnnotation>`);
  if (r.chance(0.3)) extras.push(`<dataObject id="dobj" name="${esc(label(r))}"/>`);

  const process = `<process id="proc" name="${esc(label(r))}">\n${[...nodes, sub, ...flows, ...extras].join('\n')}\n</process>`;
  if (flowable.length >= 2 && r.chance(0.3)) {
    const a = r.pick(flowable);
    const b = r.pick(flowable);
    return bpmn(
      `<collaboration id="col"><participant id="pa" name="${esc(label(r))}" processRef="proc"/><participant id="pb" name="${esc(label(r))}"/>` +
        `<messageFlow id="mf" name="${esc(label(r))}" sourceRef="${esc(a)}" targetRef="pb"/><messageFlow sourceRef="pb" targetRef="${esc(b)}"/></collaboration>\n${process}`,
    );
  }
  return bpmn(process);
}

/** A small Petri net with weights, initial and final markings, names, silent transitions and sometimes a page. */
export function randomPnml(seed: number): string {
  const r = new Rng(seed);
  const places = ids(r, 1 + r.int(5), 'p');
  const transitions = ids(r, 1 + r.int(5), 't').map((t) => (places.includes(t) ? `${t}_t` : t));
  const placeXml = places.map((id) => {
    const name = r.chance(0.6) ? `<name><text>${esc(label(r))}</text></name>` : '';
    const mark = r.chance(0.4) ? `<initialMarking><text>${String(1 + r.int(3))}</text></initialMarking>` : '';
    return `<place id="${esc(id)}">${name}${mark}</place>`;
  });
  const transitionXml = transitions.map((id) => {
    const name = r.chance(0.6) ? `<name><text>${esc(label(r))}</text></name>` : '';
    const silent = r.chance(0.2) ? '<toolspecific tool="ProM" version="6.4" activity="$invisible$"/>' : '';
    return `<transition id="${esc(id)}">${name}${silent}</transition>`;
  });
  const arcs: string[] = [];
  const arcCount = r.int(places.length + transitions.length + 3);
  for (let i = 0; i < arcCount; i++) {
    const p = r.pick(places);
    const t = r.pick(transitions);
    const [s, d] = r.chance(0.5) ? [p, t] : [t, p];
    const weight = r.chance(0.3) ? `<inscription><text>${String(2 + r.int(3))}</text></inscription>` : '';
    const name = r.chance(0.2) ? `<name><text>${esc(label(r))}</text></name>` : '';
    const id = r.chance(0.7) ? ` id="a${String(i)}"` : '';
    arcs.push(`<arc${id} source="${esc(s)}" target="${esc(d)}">${name}${weight}</arc>`);
  }
  const finals = r.chance(0.5)
    ? `<finalmarkings>${Array.from({ length: 1 + r.int(2) }, () => `<marking><place idref="${esc(r.pick(places))}"><text>${String(1 + r.int(2))}</text></place></marking>`).join('')}</finalmarkings>`
    : '';
  const body = [...placeXml, ...transitionXml, ...arcs].join('\n');
  return pnml(r.chance(0.3) ? `<page id="pg">${body}</page>\n${finals}` : `${body}\n${finals}`);
}
