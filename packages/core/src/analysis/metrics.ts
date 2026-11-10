import type { ProcessModel } from '../model.js';
import { BPMN_GATEWAY_TYPES, cyclicComponents, type FlowGraph } from './graph.js';

export const METRIC_IDS = ['size', 'density', 'connectorDegreeMean', 'connectorDegreeMax', 'cfc', 'cyclicity'] as const;
export type MetricId = (typeof METRIC_IDS)[number];

/**
 * `source`: the formula and its transfer to this formalism are given by a source listed in docs/metrics.md.
 * `transfer`: the source defines the metric for another formalism; the formula is applied unchanged and flagged.
 * `notDefined`: no source defines it for this formalism; no value is invented.
 */
export type MetricStatus = 'source' | 'transfer' | 'notDefined';
export type UndefinedReason = 'noNodes' | 'tooFewNodes' | 'noConnectors' | 'notDefinedForFormalism';

export interface Metric {
  id: MetricId;
  status: MetricStatus;
  /** Fixed format: integers in plain decimal, ratios with exactly four decimals. Null when undefined. */
  value: string | null;
  /** Inputs of a ratio, as decimal integers. */
  numerator?: string;
  denominator?: string;
  undefinedReason?: UndefinedReason;
}

/** Formulas as printed in the text report. Sources and the choice of element types: docs/metrics.md. */
export const METRIC_FORMULAS: Record<MetricId, string> = {
  size: '|N|',
  density: '|A| / (|N| * (|N| - 1))',
  connectorDegreeMean: 'sum of deg(c) over connectors / |C|, deg = in + out',
  connectorDegreeMax: 'max of deg(c) over connectors',
  cfc: 'sum over splits: XOR k, OR 2^k - 1, AND 1 (k = out-degree)',
  cyclicity: 'nodes on a cycle / |N|',
};

function ratio(numerator: bigint | number, denominator: bigint | number): string {
  return (Number(numerator) / Number(denominator)).toFixed(4);
}

/** Metrics of the control-flow graph (FA-33); see docs/metrics.md for sources and element types. */
export function computeMetrics(model: ProcessModel, g: FlowGraph): Metric[] {
  const n = g.nodes.length;
  const edges = g.edges.length;
  const isBpmn = model.formalism === 'bpmn';
  const connectors = g.nodes.flatMap((node, i) => {
    const isConnector = isBpmn ? (BPMN_GATEWAY_TYPES as readonly string[]).includes(node.type) : true;
    return isConnector && (g.inDegree[i]! > 1 || g.outDegree[i]! > 1) ? [i] : [];
  });
  const degrees = connectors.map((i) => g.inDegree[i]! + g.outDegree[i]!);
  const degreeSum = degrees.reduce((a, b) => a + b, 0);
  const cyclic = cyclicComponents(g).reduce((a, c) => a + c.length, 0);

  const size: Metric = { id: 'size', status: 'source', value: String(n) };
  const density: Metric =
    n < 2
      ? { id: 'density', status: isBpmn ? 'source' : 'transfer', value: null, undefinedReason: 'tooFewNodes' }
      : {
          id: 'density',
          status: isBpmn ? 'source' : 'transfer',
          value: ratio(edges, n * (n - 1)),
          numerator: String(edges),
          denominator: String(n * (n - 1)),
        };
  const mean: Metric =
    connectors.length === 0
      ? { id: 'connectorDegreeMean', status: 'source', value: null, undefinedReason: 'noConnectors' }
      : {
          id: 'connectorDegreeMean',
          status: 'source',
          value: ratio(degreeSum, connectors.length),
          numerator: String(degreeSum),
          denominator: String(connectors.length),
        };
  const max: Metric =
    connectors.length === 0
      ? { id: 'connectorDegreeMax', status: 'source', value: null, undefinedReason: 'noConnectors' }
      : { id: 'connectorDegreeMax', status: 'source', value: String(Math.max(...degrees)) };
  let cfc: Metric;
  if (isBpmn) {
    let sum = 0n;
    g.nodes.forEach((node, i) => {
      const k = g.outDegree[i]!;
      if (k <= 1) return;
      if (node.type === 'exclusiveGateway' || node.type === 'eventBasedGateway') sum += BigInt(k);
      else if (node.type === 'inclusiveGateway') sum += 2n ** BigInt(k) - 1n;
      else if (node.type === 'parallelGateway') sum += 1n;
    });
    cfc = { id: 'cfc', status: 'source', value: sum.toString() };
  } else {
    cfc = { id: 'cfc', status: 'notDefined', value: null, undefinedReason: 'notDefinedForFormalism' };
  }
  const cyclicity: Metric =
    n === 0
      ? { id: 'cyclicity', status: 'source', value: null, undefinedReason: 'noNodes' }
      : { id: 'cyclicity', status: 'source', value: ratio(cyclic, n), numerator: String(cyclic), denominator: String(n) };
  return [size, density, mean, max, cfc, cyclicity];
}
