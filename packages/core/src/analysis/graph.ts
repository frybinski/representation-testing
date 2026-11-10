import type { EdgeType, ModelEdge, ModelNode, NodeType, ProcessModel } from '../model.js';

/** BPMN node types that take part in sequence flow (the "process graph" of the metric literature). */
export const BPMN_FLOW_NODE_TYPES: readonly NodeType[] = [
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
];

export const BPMN_GATEWAY_TYPES = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway'] as const;

/** Locale independent, code-unit order. The only ordering used for ids in the analysis (R-5). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The control-flow graph of a model: flow nodes and the edges that carry control flow
 * (sequence flows in BPMN, arcs in Petri nets). Nodes are sorted by id; all index based
 * lists refer to that order. Message flows, associations and data associations are not part of it.
 */
export interface FlowGraph {
  formalism: ProcessModel['formalism'];
  nodes: ModelNode[];
  index: Map<string, number>;
  /** Flow edges in model order. */
  edges: ModelEdge[];
  /** Edge counts with multiplicity (parallel edges and self loops each count). */
  inDegree: number[];
  outDegree: number[];
  /** Distinct successors / predecessors, ascending. Used for reachability and cycles. */
  succ: number[][];
  pred: number[][];
}

export function buildFlowGraph(model: ProcessModel): FlowGraph {
  const flowTypes: readonly NodeType[] = model.formalism === 'bpmn' ? BPMN_FLOW_NODE_TYPES : ['place', 'transition'];
  const edgeType: EdgeType = model.formalism === 'bpmn' ? 'sequenceFlow' : 'arc';
  const nodes = model.nodes.filter((n) => flowTypes.includes(n.type)).sort((a, b) => compareIds(a.id, b.id));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: ModelEdge[] = [];
  const inDegree = nodes.map(() => 0);
  const outDegree = nodes.map(() => 0);
  const succSets = nodes.map(() => new Set<number>());
  const predSets = nodes.map(() => new Set<number>());
  for (const e of model.edges) {
    if (e.type !== edgeType) continue;
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s === undefined || t === undefined) continue;
    edges.push(e);
    outDegree[s]!++;
    inDegree[t]!++;
    succSets[s]!.add(t);
    predSets[t]!.add(s);
  }
  const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
  return {
    formalism: model.formalism,
    nodes,
    index,
    edges,
    inDegree,
    outDegree,
    succ: succSets.map(sorted),
    pred: predSets.map(sorted),
  };
}

/** Strongly connected components (iterative Tarjan). Each component ascending, components ordered by smallest member. */
export function stronglyConnectedComponents(g: FlowGraph): number[][] {
  const n = g.nodes.length;
  const idx = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const result: number[][] = [];
  let counter = 0;
  for (let root = 0; root < n; root++) {
    if (idx[root] !== -1) continue;
    const work: { v: number; next: number }[] = [{ v: root, next: 0 }];
    idx[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.v;
      const succ = g.succ[v]!;
      if (frame.next < succ.length) {
        const w = succ[frame.next++]!;
        if (idx[w] === -1) {
          idx[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          work.push({ v: w, next: 0 });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, idx[w]!);
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!.v;
          low[parent] = Math.min(low[parent]!, low[v]!);
        }
        if (low[v] === idx[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            comp.push(w);
          } while (w !== v);
          result.push(comp.sort((a, b) => a - b));
        }
      }
    }
  }
  return result.sort((a, b) => a[0]! - b[0]!);
}

/** Components that contain a cycle: more than one node, or a single node with a self loop. */
export function cyclicComponents(g: FlowGraph): number[][] {
  return stronglyConnectedComponents(g).filter((c) => c.length > 1 || g.succ[c[0]!]!.includes(c[0]!));
}

export interface CycleEnumeration {
  /** Elementary cycles as node indices, each starting at its smallest index, in discovery order. */
  cycles: number[][];
  /** False when `maxCycles` or `maxSteps` stopped the enumeration. */
  complete: boolean;
}

/**
 * Elementary cycles (no repeated node), each reported once, rotated to start at its smallest node.
 * Per start node a depth first search restricted to larger nodes of the same strongly connected component.
 * The number of cycles can be exponential, hence both limits; a step is one edge visit.
 */
export function enumerateCycles(g: FlowGraph, maxCycles: number, maxSteps: number): CycleEnumeration {
  const cycles: number[][] = [];
  let steps = 0;
  for (const comp of cyclicComponents(g)) {
    const inComp = new Set(comp);
    for (const start of comp) {
      const path = [start];
      const onPath = new Set([start]);
      const frames: { v: number; next: number }[] = [{ v: start, next: 0 }];
      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        const succ = g.succ[frame.v]!;
        if (frame.next >= succ.length) {
          frames.pop();
          onPath.delete(path.pop()!);
          continue;
        }
        const w = succ[frame.next++]!;
        if (++steps > maxSteps) return { cycles, complete: false };
        if (w === start) {
          if (cycles.length >= maxCycles) return { cycles, complete: false };
          cycles.push([...path]);
        } else if (w > start && inComp.has(w) && !onPath.has(w)) {
          path.push(w);
          onPath.add(w);
          frames.push({ v: w, next: 0 });
        }
      }
    }
  }
  return { cycles, complete: true };
}

/** Weakly connected components over flow edges, members ascending, components ordered by smallest member. */
export function weakComponents(g: FlowGraph): number[][] {
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  g.succ.forEach((targets, s) => {
    for (const t of targets) {
      const a = find(s);
      const b = find(t);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  const groups = new Map<number, number[]>();
  g.nodes.forEach((_, i) => {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

/**
 * Immediate post-dominator of every node (Cooper, Harvey, Kennedy: iterative dominator algorithm
 * on the reversed graph, with a virtual exit after every node without successor).
 * Returns -1 for a node without post-dominator (cannot reach the exit, or its only
 * post-dominator is the virtual exit).
 */
export function immediatePostDominators(g: FlowGraph): number[] {
  const n = g.nodes.length;
  const exit = n;
  // successors in the reversed graph = predecessors in the flow graph; the exit points to every end node
  const revSucc: number[][] = g.pred.map((p) => p);
  revSucc.push(g.succ.map((s, i) => (s.length === 0 ? i : -1)).filter((i) => i >= 0));
  const order: number[] = [];
  const seen = new Array<boolean>(n + 1).fill(false);
  const work: { v: number; next: number }[] = [{ v: exit, next: 0 }];
  seen[exit] = true;
  while (work.length > 0) {
    const f = work[work.length - 1]!;
    const out = revSucc[f.v]!;
    if (f.next < out.length) {
      const w = out[f.next++]!;
      if (!seen[w]) {
        seen[w] = true;
        work.push({ v: w, next: 0 });
      }
    } else {
      order.push(f.v);
      work.pop();
    }
  }
  const rpo = order.reverse();
  const pos = new Array<number>(n + 1).fill(-1);
  rpo.forEach((v, i) => (pos[v] = i));
  const idom = new Array<number>(n + 1).fill(-1);
  idom[exit] = exit;
  const revPred = (v: number): number[] => (g.succ[v]!.length === 0 ? [exit] : g.succ[v]!);
  const intersect = (a: number, b: number): number => {
    while (a !== b) {
      while (pos[a]! > pos[b]!) a = idom[a]!;
      while (pos[b]! > pos[a]!) b = idom[b]!;
    }
    return a;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of rpo) {
      if (v === exit) continue;
      let next = -1;
      for (const p of revPred(v)) {
        if (idom[p] === -1) continue;
        next = next === -1 ? p : intersect(p, next);
      }
      if (next !== -1 && idom[v] !== next) {
        idom[v] = next;
        changed = true;
      }
    }
  }
  return idom.slice(0, n).map((d) => (d === exit ? -1 : d));
}
