import { NODE_TYPES, EDGE_TYPES, type EdgeType, type NodeType, type ProcessModel } from '../model.js';
import {
  BPMN_GATEWAY_TYPES,
  buildFlowGraph,
  compareIds,
  cyclicComponents,
  enumerateCycles,
  immediatePostDominators,
  weakComponents,
  type FlowGraph,
} from './graph.js';
import { analyzePetriNet, type PetriNetReport, type PetriOptions } from './petri.js';
import { computeMetrics, type Metric } from './metrics.js';

export const STRUCTURE_REPORT_FORMAT = 'repr-werkbank/structure-report' as const;
export const STRUCTURE_REPORT_VERSION = 1 as const;

export const DEFAULT_MAX_CYCLES = 50;
export const DEFAULT_MAX_CYCLE_STEPS = 200_000;

export interface StructureOptions extends PetriOptions {
  /** Cycles to list at most. The count of nodes on cycles is always exact. Default 50. */
  maxCycles?: number;
  /** Edge visits the cycle enumeration may spend. Default 200 000. */
  maxCycleSteps?: number;
}

export interface TypeCount<T extends string> {
  type: T;
  count: number;
}

export interface NodeRef {
  id: string;
  type: NodeType;
}

export interface Connector extends NodeRef {
  in: number;
  out: number;
}

export interface GatewayKindStats {
  kind: (typeof BPMN_GATEWAY_TYPES)[number];
  count: number;
  splits: number;
  joins: number;
}

export interface GatewayPair {
  split: string;
  splitKind: string;
  join: string;
  joinKind: string;
}

export interface FlowRef {
  /** Edge key, see ModelEdge. */
  key: string;
  source: string;
  target: string;
}

export interface ExclusiveGatewayFlows {
  gateway: string;
  flows: (FlowRef & { hasCondition: boolean; isDefault: boolean })[];
}

export interface BpmnPart {
  gateways: GatewayKindStats[];
  /** Split gateways whose immediate post-dominator is a join gateway; see docs/structure-report.md. */
  pairs: GatewayPair[];
  mismatchedPairs: GatewayPair[];
  /** Split gateways without such a join. */
  unpairedSplits: string[];
  exclusiveGateways: {
    /** Outgoing sequence flows of exclusive gateways with more than one outgoing flow. */
    gateways: ExclusiveGatewayFlows[];
    flows: number;
    withCondition: number;
    withoutCondition: number;
    /** Without condition and not marked as default flow. */
    withoutConditionNotDefault: number;
  };
  /** Every sequence flow marked as default flow. */
  defaultFlows: FlowRef[];
}

export interface StructureReport {
  format: typeof STRUCTURE_REPORT_FORMAT;
  version: typeof STRUCTURE_REPORT_VERSION;
  formalism: ProcessModel['formalism'];
  counts: {
    /** All nodes of the model, per type (types without nodes are omitted), in the order of NODE_TYPES. */
    nodesByType: TypeCount<NodeType>[];
    edgesByType: TypeCount<EdgeType>[];
    nodes: number;
    edges: number;
    /** Nodes and edges of the control-flow graph (see docs/structure-report.md). */
    flowNodes: number;
    flowEdges: number;
  };
  starts: NodeRef[];
  ends: NodeRef[];
  splits: Connector[];
  joins: Connector[];
  loops: {
    /** Flow nodes on at least one cycle (exact). */
    cyclicNodes: string[];
    /** Strongly connected components that contain a cycle. */
    components: string[][];
    /** Elementary cycles, each starting at its smallest id; at most `limit.maxCycles` of them. */
    cycles: string[][];
    /** False when the listing stopped at a limit; then `cycles` is a prefix of all cycles. */
    cyclesComplete: boolean;
    limit: { maxCycles: number; maxSteps: number };
  };
  /** Weakly connected components of the flow graph; more than one means unconnected parts. */
  components: string[][];
  unlabelled: NodeRef[];
  bpmn?: BpmnPart;
  petri?: PetriNetReport;
  metrics: Metric[];
}

function countBy<T extends string>(order: readonly T[], values: T[]): TypeCount<T>[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return order.filter((t) => counts.has(t)).map((t) => ({ type: t, count: counts.get(t)! }));
}

function bpmnPart(model: ProcessModel, g: FlowGraph): BpmnPart {
  const gatewayIdx = g.nodes.flatMap((n, i) => ((BPMN_GATEWAY_TYPES as readonly string[]).includes(n.type) ? [i] : []));
  const gateways: GatewayKindStats[] = BPMN_GATEWAY_TYPES.map((kind) => {
    const of = gatewayIdx.filter((i) => g.nodes[i]!.type === kind);
    return {
      kind,
      count: of.length,
      splits: of.filter((i) => g.outDegree[i]! > 1).length,
      joins: of.filter((i) => g.inDegree[i]! > 1).length,
    };
  });
  const ipdom = immediatePostDominators(g);
  const pairs: GatewayPair[] = [];
  const unpairedSplits: string[] = [];
  for (const i of gatewayIdx) {
    if (g.outDegree[i]! <= 1) continue;
    const j = ipdom[i]!;
    const join = j >= 0 ? g.nodes[j]! : undefined;
    if (join && (BPMN_GATEWAY_TYPES as readonly string[]).includes(join.type) && g.inDegree[j]! > 1) {
      pairs.push({ split: g.nodes[i]!.id, splitKind: g.nodes[i]!.type, join: join.id, joinKind: join.type });
    } else unpairedSplits.push(g.nodes[i]!.id);
  }
  const flowRef = (e: (typeof g.edges)[number]): FlowRef => ({ key: e.key, source: e.source, target: e.target });
  const exclusive: ExclusiveGatewayFlows[] = [];
  for (const i of gatewayIdx) {
    const n = g.nodes[i]!;
    if (n.type !== 'exclusiveGateway' || g.outDegree[i]! <= 1) continue;
    const flows = g.edges
      .filter((e) => e.source === n.id)
      .map((e) => ({ ...flowRef(e), hasCondition: e.attributes.condition !== undefined, isDefault: e.attributes.isDefault === true }))
      .sort((a, b) => compareIds(a.key, b.key));
    exclusive.push({ gateway: n.id, flows });
  }
  const all = exclusive.flatMap((x) => x.flows);
  return {
    gateways,
    pairs,
    mismatchedPairs: pairs.filter((p) => p.splitKind !== p.joinKind),
    unpairedSplits,
    exclusiveGateways: {
      gateways: exclusive,
      flows: all.length,
      withCondition: all.filter((f) => f.hasCondition).length,
      withoutCondition: all.filter((f) => !f.hasCondition).length,
      withoutConditionNotDefault: all.filter((f) => !f.hasCondition && !f.isDefault).length,
    },
    defaultFlows: model.edges
      .filter((e) => e.type === 'sequenceFlow' && e.attributes.isDefault === true)
      .map(flowRef)
      .sort((a, b) => compareIds(a.key, b.key)),
  };
}

/**
 * Structure report (FA-30 to FA-33): computed properties of a model, not facts of it.
 * Pure and deterministic: every list has a fixed order (ids in code-unit order, types in the
 * order of the model's type lists), no value depends on object key order or locale.
 */
export function analyzeStructure(model: ProcessModel, options: StructureOptions = {}): StructureReport {
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxSteps = options.maxCycleSteps ?? DEFAULT_MAX_CYCLE_STEPS;
  const g = buildFlowGraph(model);
  const ref = (i: number): NodeRef => ({ id: g.nodes[i]!.id, type: g.nodes[i]!.type });
  const ids = (list: number[]): string[] => list.map((i) => g.nodes[i]!.id);
  const all = g.nodes.map((_, i) => i);
  const connector = (i: number): Connector => ({ ...ref(i), in: g.inDegree[i]!, out: g.outDegree[i]! });

  const cyc = cyclicComponents(g);
  const enumeration = enumerateCycles(g, maxCycles, maxSteps);

  const report: StructureReport = {
    format: STRUCTURE_REPORT_FORMAT,
    version: STRUCTURE_REPORT_VERSION,
    formalism: model.formalism,
    counts: {
      nodesByType: countBy(NODE_TYPES, model.nodes.map((n) => n.type)),
      edgesByType: countBy(EDGE_TYPES, model.edges.map((e) => e.type)),
      nodes: model.nodes.length,
      edges: model.edges.length,
      flowNodes: g.nodes.length,
      flowEdges: g.edges.length,
    },
    starts: all.filter((i) => g.inDegree[i] === 0).map(ref),
    ends: all.filter((i) => g.outDegree[i] === 0).map(ref),
    splits: all.filter((i) => g.outDegree[i]! > 1).map(connector),
    joins: all.filter((i) => g.inDegree[i]! > 1).map(connector),
    loops: {
      cyclicNodes: ids(cyc.flat().sort((a, b) => a - b)),
      components: cyc.map(ids),
      cycles: enumeration.cycles.map(ids),
      cyclesComplete: enumeration.complete,
      limit: { maxCycles, maxSteps },
    },
    components: weakComponents(g).map(ids),
    unlabelled: all.filter((i) => (g.nodes[i]!.name ?? '').trim() === '').map(ref),
    metrics: [],
  };
  if (model.formalism === 'bpmn') report.bpmn = bpmnPart(model, g);
  else report.petri = analyzePetriNet(model, options);
  report.metrics = computeMetrics(model, g);
  return report;
}
