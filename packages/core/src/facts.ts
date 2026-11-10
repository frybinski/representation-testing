import type { Fact, FactCategory, ModelEdge, ProcessModel } from './model.js';

/**
 * A fact's id depends only on model content (category, subject, aspect, value),
 * never on counters or reading order. Two fact sets can therefore be compared
 * by id with plain set operations.
 */
export function makeFact(category: FactCategory, subject: string, aspect: string, value: string): Fact {
  return { id: JSON.stringify([category, subject, aspect, value]), category, subject, aspect, value };
}

/** Identity of an edge in facts: [source, target], plus the occurrence for repeated endpoint pairs. */
export function edgeKey(source: string, target: string, occurrence = 1): string {
  return JSON.stringify(occurrence > 1 ? [source, target, occurrence] : [source, target]);
}

export function factIds(facts: readonly Fact[]): Set<string> {
  return new Set(facts.map((f) => f.id));
}

/** Facts in `a` that are not in `b`, in the order of `a`. */
export function diffFacts(a: readonly Fact[], b: readonly Fact[]): Fact[] {
  const ids = factIds(b);
  return a.filter((f) => !ids.has(f.id));
}

export function sameFacts(a: readonly Fact[], b: readonly Fact[]): boolean {
  return diffFacts(a, b).length === 0 && diffFacts(b, a).length === 0;
}

const BPMN_FLOW_NODES = new Set([
  'task',
  'userTask',
  'serviceTask',
  'scriptTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'businessRuleTask',
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'eventBasedGateway',
  'subProcess',
]);
const BPMN_POOL_LANE = new Set(['process', 'collaboration', 'participant', 'lane']);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function edgeFacts(e: ModelEdge, out: Fact[]): void {
  const k = e.key;
  if (e.id !== undefined) out.push(makeFact('identifier', k, '', e.id));
  switch (e.type) {
    case 'sequenceFlow':
      out.push(makeFact('sequenceFlow', k, '', ''));
      if (e.name) out.push(makeFact('sequenceFlowName', k, '', e.name));
      if (typeof e.attributes.condition === 'string') {
        out.push(makeFact('condition', k, '', e.attributes.condition));
      }
      if (e.attributes.isDefault === true) out.push(makeFact('defaultFlow', k, '', ''));
      break;
    case 'messageFlow':
      out.push(makeFact('messageFlow', k, '', ''));
      if (e.name) out.push(makeFact('label', k, '', e.name));
      break;
    case 'association':
      out.push(makeFact('annotation', k, 'association', ''));
      break;
    case 'dataInputAssociation':
      out.push(makeFact('dataObject', k, 'association', 'input'));
      break;
    case 'dataOutputAssociation':
      out.push(makeFact('dataObject', k, 'association', 'output'));
      break;
    case 'arc':
      out.push(makeFact('arc', k, '', ''));
      if (e.name) out.push(makeFact('label', k, '', e.name));
      if (typeof e.attributes.weight === 'number' && e.attributes.weight !== 1) {
        out.push(makeFact('arcWeight', k, '', String(e.attributes.weight)));
      }
      break;
  }
}

/** Derives the fact set of a model (FA-10, FA-11). Pure function of nodes, edges and layout. */
export function deriveFacts(model: Pick<ProcessModel, 'formalism' | 'nodes' | 'edges' | 'layout'>): Fact[] {
  const out: Fact[] = [];
  for (const n of model.nodes) {
    if (n.idExplicit) out.push(makeFact('identifier', n.id, '', n.id));
    if (n.name) out.push(makeFact('label', n.id, '', n.name));
    if (model.formalism === 'bpmn') {
      if (BPMN_FLOW_NODES.has(n.type)) {
        out.push(makeFact('node', n.id, '', ''));
        if (n.parent !== undefined) out.push(makeFact('node', n.id, 'parent', n.parent));
        out.push(makeFact('nodeType', n.id, '', n.type));
        for (const d of strings(n.attributes.eventDefinitions)) {
          out.push(makeFact('eventType', n.id, '', d));
        }
      } else if (BPMN_POOL_LANE.has(n.type)) {
        out.push(makeFact('poolLane', n.id, 'kind', n.type));
        if (n.parent !== undefined) out.push(makeFact('poolLane', n.id, 'parent', n.parent));
        if (typeof n.attributes.processRef === 'string') {
          out.push(makeFact('poolLane', n.id, 'process', n.attributes.processRef));
        }
        for (const m of strings(n.attributes.flowNodeRefs)) {
          out.push(makeFact('poolLane', n.id, 'member', m));
        }
      } else if (n.type === 'dataObject' || n.type === 'dataObjectReference') {
        out.push(makeFact('dataObject', n.id, 'kind', n.type));
        if (n.parent !== undefined) out.push(makeFact('dataObject', n.id, 'parent', n.parent));
        if (typeof n.attributes.dataObjectRef === 'string') {
          out.push(makeFact('dataObject', n.id, 'ref', n.attributes.dataObjectRef));
        }
      } else if (n.type === 'textAnnotation') {
        out.push(makeFact('annotation', n.id, 'kind', n.type));
        if (n.parent !== undefined) out.push(makeFact('annotation', n.id, 'parent', n.parent));
        out.push(makeFact('annotation', n.id, 'text', String(n.attributes.text ?? '')));
      }
    } else if (n.type === 'place') {
      out.push(makeFact('place', n.id, '', ''));
      const initial = n.attributes.initialMarking;
      if (typeof initial === 'number' && initial > 0) {
        out.push(makeFact('initialMarking', n.id, '', String(initial)));
      }
      const finals = Array.isArray(n.attributes.finalMarkings) ? n.attributes.finalMarkings : [];
      finals.forEach((tokens, i) => {
        if (typeof tokens === 'number' && tokens > 0) {
          out.push(makeFact('finalMarking', n.id, finals.length > 1 ? `m${String(i + 1)}` : '', String(tokens)));
        }
      });
    } else if (n.type === 'transition') {
      out.push(makeFact('transition', n.id, '', ''));
      if (n.attributes.silent === true) out.push(makeFact('silentTransition', n.id, '', ''));
    }
  }
  for (const e of model.edges) edgeFacts(e, out);
  for (const l of model.layout) out.push(makeFact('layout', l.subject, l.aspect, l.value));

  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.id) && seen.add(f.id));
}
