import type { ModelEdge, ModelNode, NodeType, ProcessModel } from '../model.js';
import type { ShapeKind } from './geometry.js';
import { FONT, LINE } from './scene.js';
import { normalizeLabel, textWidth, wrapText } from './metrics.js';

export const TASK_TYPES = new Set<NodeType>(['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask']);
export const EVENT_NODE_TYPES = new Set<NodeType>(['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent']);
export const GATEWAY_TYPES = new Set<NodeType>(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway']);
/** Node types that have a shape in the diagram. Processes, the collaboration and data object definitions have none. */
export const DRAWN_BPMN = new Set<NodeType>([
  ...TASK_TYPES,
  ...EVENT_NODE_TYPES,
  ...GATEWAY_TYPES,
  'subProcess',
  'participant',
  'lane',
  'dataObjectReference',
  'textAnnotation',
]);
export const DRAWN_BPMN_EDGES = new Set<ModelEdge['type']>(['sequenceFlow', 'messageFlow', 'association', 'dataInputAssociation', 'dataOutputAssociation']);

export const CELL_PAD = 8;
export const SUB_PAD = 16;
export const SUB_HEAD = 24;

export type BpmnShapeClass = 'task' | 'subProcess' | 'event' | 'gateway' | 'data' | 'annotation' | 'pool' | 'lane';

export function shapeClassOf(type: NodeType): BpmnShapeClass | null {
  if (TASK_TYPES.has(type)) return 'task';
  if (type === 'subProcess') return 'subProcess';
  if (EVENT_NODE_TYPES.has(type)) return 'event';
  if (GATEWAY_TYPES.has(type)) return 'gateway';
  if (type === 'dataObjectReference') return 'data';
  if (type === 'textAnnotation') return 'annotation';
  if (type === 'participant') return 'pool';
  if (type === 'lane') return 'lane';
  return null;
}

export function shapeKindOf(type: NodeType): ShapeKind {
  const c = shapeClassOf(type);
  return c === 'event' ? 'ellipse' : c === 'gateway' ? 'diamond' : 'rect';
}

/** The text a node shows: the name, or the text of an annotation. */
export function labelOf(n: ModelNode): string {
  if (n.type === 'textAnnotation') return typeof n.attributes.text === 'string' ? normalizeLabel(n.attributes.text) : '';
  return n.name === undefined ? '' : normalizeLabel(n.name);
}

export interface BoxSpec {
  shapeW: number;
  shapeH: number;
  /** Lines of a label that stands below the shape (events, gateways, data objects); empty otherwise. */
  below: string[];
  belowW: number;
  belowH: number;
}

const BELOW_WRAP = 96;

/** Natural size of a drawn node. Tasks and annotations size themselves to their wrapped label. */
export function boxSpec(n: ModelNode): BoxSpec {
  const cls = shapeClassOf(n.type);
  const label = labelOf(n);
  const none: BoxSpec = { shapeW: 0, shapeH: 0, below: [], belowW: 0, belowH: 0 };
  const below = (w: number, h: number): BoxSpec => {
    const lines = label === '' ? [] : wrapText(label, FONT, BELOW_WRAP);
    return { shapeW: w, shapeH: h, below: lines, belowW: Math.max(0, ...lines.map((l) => textWidth(l, FONT))), belowH: lines.length * LINE };
  };
  switch (cls) {
    case 'event':
      return below(36, 36);
    case 'gateway':
      return below(40, 40);
    case 'data':
      return below(36, 50);
    case 'task':
    case 'subProcess': {
      let w = 100;
      let lines = wrapText(label, FONT, w - 2 * CELL_PAD);
      for (const cand of [100, 140, 180, 240]) {
        w = cand;
        lines = wrapText(label, FONT, w - 2 * CELL_PAD);
        if (lines.length <= 4) break;
      }
      return { ...none, shapeW: w, shapeH: Math.max(80, lines.length * LINE + 32) };
    }
    case 'annotation': {
      const lines = wrapText(label, FONT, 140 - 20);
      return { ...none, shapeW: 140, shapeH: Math.max(32, lines.length * LINE + 12) };
    }
    default:
      return none;
  }
}

export interface Header {
  lines: string[];
  /** Thickness of the label band. */
  size: number;
}

/** Label band of a pool or lane whose band has `length` px along the label. The band grows with the number of lines, nothing is cut off. */
export function headerLayout(label: string, length: number): Header {
  const lines = label === '' ? [] : wrapText(label, FONT, Math.max(40, length - 16));
  return { lines, size: Math.max(28, 12 + LINE * lines.length) };
}

export interface BpmnIndex {
  byId: Map<string, ModelNode>;
  children: Map<string, ModelNode[]>;
  edgesByKey: Map<string, ModelEdge>;
}

export function indexOf(model: ProcessModel): BpmnIndex {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const children = new Map<string, ModelNode[]>();
  for (const n of model.nodes) {
    if (n.parent === undefined) continue;
    const list = children.get(n.parent);
    if (list) list.push(n);
    else children.set(n.parent, [n]);
  }
  return { byId, children, edgesByKey: new Map(model.edges.map((e) => [e.key, e])) };
}

/** Parses "a,b,c" numbers as written by the BPMN reader; null when malformed. */
export function numbers(value: string | undefined, count: number): number[] | null {
  if (value === undefined) return null;
  const parts = value.split(',').map((p) => Number(p));
  return parts.length === count && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

export function waypointsOf(value: string | undefined): { x: number; y: number }[] | null {
  if (value === undefined) return null;
  const out: { x: number; y: number }[] = [];
  for (const part of value.split(';')) {
    const xy = numbers(part, 2);
    if (!xy) return null;
    out.push({ x: xy[0] ?? 0, y: xy[1] ?? 0 });
  }
  return out;
}

/** layout entries by subject and aspect; the first entry of an aspect wins. */
export function layoutIndex(model: ProcessModel): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const l of model.layout) {
    let m = out.get(l.subject);
    if (!m) out.set(l.subject, (m = new Map<string, string>()));
    if (!m.has(l.aspect)) m.set(l.aspect, l.value);
  }
  return out;
}

/** Label of a sub-process drawn as container: lines at the top inside, and the height of that header. */
export function subProcessHeader(label: string, width: number): { lines: string[]; height: number } {
  const lines = label === '' ? [] : wrapText(label, FONT, Math.max(40, width - 2 * CELL_PAD));
  return { lines, height: Math.max(SUB_HEAD, lines.length * LINE + 10) };
}
