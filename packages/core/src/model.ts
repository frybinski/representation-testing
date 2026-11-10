/**
 * Internal model shared by the BPMN and PNML parsers (FA-10).
 *
 * The JSON Schema in docs/model.schema.json describes exactly these types;
 * test/schema-sync.test.ts fails when the two drift apart.
 */

export const SCHEMA_VERSION = 1 as const;

export const FORMALISMS = ['bpmn', 'pnml'] as const;
export type Formalism = (typeof FORMALISMS)[number];

export const BPMN_NODE_TYPES = [
  'process',
  'collaboration',
  'participant',
  'lane',
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
  'dataObject',
  'dataObjectReference',
  'textAnnotation',
] as const;

export const PNML_NODE_TYPES = ['net', 'page', 'place', 'transition'] as const;

export const NODE_TYPES = [...BPMN_NODE_TYPES, ...PNML_NODE_TYPES] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'sequenceFlow',
  'messageFlow',
  'association',
  'dataInputAssociation',
  'dataOutputAssociation',
  'arc',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** Fact categories of FA-50. Each fact carries exactly one. */
export const BPMN_FACT_CATEGORIES = [
  'node',
  'nodeType',
  'label',
  'identifier',
  'sequenceFlow',
  'sequenceFlowName',
  'condition',
  'defaultFlow',
  'eventType',
  'poolLane',
  'messageFlow',
  'dataObject',
  'annotation',
  'layout',
] as const;

export const PNML_FACT_CATEGORIES = [
  'place',
  'transition',
  'label',
  'identifier',
  'arc',
  'arcWeight',
  'initialMarking',
  'finalMarking',
  'silentTransition',
  'layout',
] as const;

export const FACT_CATEGORIES = [
  ...BPMN_FACT_CATEGORIES,
  ...PNML_FACT_CATEGORIES.filter((c) => !(BPMN_FACT_CATEGORIES as readonly string[]).includes(c)),
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const NOTICE_KINDS = [
  'unsupported-element',
  'unsupported-attribute',
  'extension',
  'dropped-dependent',
  'invalid-value',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Location in the original text. Offsets are UTF-16 code unit indices, line and column are 1-based. */
export interface SourceRange {
  line: number;
  column: number;
  start: number;
  end: number;
}

export type AttributeValue = string | number | boolean | string[] | number[];

export interface ModelNode {
  /** Explicit id from the file, or a synthesized `anon_<type>_<k>` id. */
  id: string;
  idExplicit: boolean;
  type: NodeType;
  name?: string;
  /** Id of the containing node (process, sub-process, collaboration, net, page, parent lane). */
  parent?: string;
  attributes: Record<string, AttributeValue>;
  loc: SourceRange;
}

export interface ModelEdge {
  /** Identity of the edge in facts: JSON array of [source, target], with a third element (occurrence, >= 2) for repeated endpoint pairs. */
  key: string;
  /** Only present when the file gives the edge an id. */
  id?: string;
  type: EdgeType;
  source: string;
  target: string;
  name?: string;
  parent?: string;
  attributes: Record<string, AttributeValue>;
  loc: SourceRange;
}

/** One layout statement: diagram data (BPMN DI) or graphics (PNML). `subject` is a node id or an edge key. */
export interface LayoutEntry {
  subject: string;
  aspect: string;
  value: string;
  loc: SourceRange;
}

export interface Fact {
  /** Derived from the other fields only, see makeFact. */
  id: string;
  category: FactCategory;
  subject: string;
  aspect: string;
  value: string;
}

export interface NoticeItem {
  id?: string;
  line: number;
  host?: string;
  detail?: string;
}

export interface Notice {
  kind: NoticeKind;
  type: string;
  namespace?: string;
  count: number;
  items: NoticeItem[];
}

export interface ProcessModel {
  schemaVersion: typeof SCHEMA_VERSION;
  formalism: Formalism;
  nodes: ModelNode[];
  edges: ModelEdge[];
  layout: LayoutEntry[];
  /** Ranges of the layout carrying elements (BPMNDiagram, graphics) in the original text. */
  layoutRanges: SourceRange[];
  facts: Fact[];
  notices: Notice[];
}
