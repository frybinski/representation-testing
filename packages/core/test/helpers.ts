import type { Fact, FactCategory, ProcessModel } from '../src/index.js';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

export function bpmn(body: string, extraNs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="${BPMN_NS}"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${extraNs}
  targetNamespace="urn:test">
${body}
</definitions>`;
}

export function pnml(body: string, netType = 'http://www.pnml.org/version-2009/grammar/pnmlcoremodel'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<pnml>
<net id="net1" type="${netType}">
${body}
</net>
</pnml>`;
}

/** Readable form of a fact: category|subject|aspect|value. */
export function show(f: Fact): string {
  return [f.category, f.subject, f.aspect, f.value].join('|');
}

export function factsOf(model: ProcessModel, category: FactCategory): string[] {
  return model.facts.filter((f) => f.category === category).map(show);
}

export function allFacts(model: ProcessModel): string[] {
  return model.facts.map(show);
}
