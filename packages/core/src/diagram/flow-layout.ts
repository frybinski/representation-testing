import * as dagre from '@dagrejs/dagre';
import { simplify } from './geometry.js';
import type { Pt, Rect } from './svg.js';

/** One element to place: a shape and an optional label below it. Sizes in px. */
export interface FlowCell {
  id: string;
  shapeW: number;
  shapeH: number;
  /** Size of the label below the shape, 0 when the label is inside the shape or missing. */
  labelW: number;
  labelH: number;
}

export interface FlowEdge {
  key: string;
  source: string;
  target: string;
  /** Width of the text on the edge, to widen the gap between ranks. */
  labelW: number;
}

export interface FlowLayout {
  /** Rectangle of the shape of each cell. */
  shapes: Map<string, Rect>;
  /** Rectangle that contains shape and label. */
  cells: Map<string, Rect>;
  /** Route of each edge, from the source shape to the target shape. */
  paths: Map<string, Pt[]>;
  width: number;
  height: number;
}

export type Direction = 'LR' | 'TB';

/** The part of the dagre / graphlib interface used here. dagre's own typings reach graphlib's, which are not resolved under `skipLibCheck`. */
interface DagreGraph {
  setGraph(label: object): void;
  setDefaultEdgeLabel(f: () => object): void;
  setNode(id: string, label: { width: number; height: number }): void;
  setEdge(v: string, w: string, label: object, name: string): void;
  node(id: string): { x?: number; y?: number };
  edge(v: string, w: string, name: string): { points?: Pt[] };
}
const GraphClass = dagre.Graph as unknown as new (options: { multigraph: boolean }) => DagreGraph;
const runLayout = dagre.layout as unknown as (g: DagreGraph) => void;

export const LABEL_GAP = 4;
const NODE_SEP = 28;
const RANK_SEP = 56;
const BACK_CHANNEL = 14;

interface FrameNode {
  id: string;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  shape: Rect;
}

/**
 * Layered layout of one level of a model (a process, a sub-process, a net) with dagre (docs/diagram.md). dagre places the cells;
 * the routes are drawn here as orthogonal lines through the gaps between the ranks, with the bends of long edges taken from dagre's
 * dummy nodes. Everything is computed in a left-to-right frame; `TB` transposes cells in and the result out.
 */
export function layoutFlow(cells: readonly FlowCell[], edges: readonly FlowEdge[], direction: Direction): FlowLayout {
  const tb = direction === 'TB';
  const g = new GraphClass({ multigraph: true });
  const longest = edges.reduce((m, e) => Math.max(m, e.labelW), 0);
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP + Math.min(longest, 120), edgesep: 12, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre keeps nodes in plain objects, so model ids such as "__proto__" must not be used as keys.
  const index = new Map<string, number>();
  const nodes: FrameNode[] = [];
  cells.forEach((c, i) => {
    index.set(c.id, i);
    const cellW = Math.max(c.shapeW, c.labelW);
    // Room for the label on both sides keeps the shape in the middle of its cell, so chains of cells stay on one straight line.
    const cellH = c.shapeH + (c.labelH > 0 ? 2 * (c.labelH + LABEL_GAP) : 0);
    const fw = tb ? cellH : cellW;
    const fh = tb ? cellW : cellH;
    g.setNode(`n${String(i)}`, { width: fw, height: fh });
    nodes.push({ id: c.id, fx: 0, fy: 0, fw, fh, shape: { x: 0, y: 0, w: tb ? c.shapeH : c.shapeW, h: tb ? c.shapeW : c.shapeH } });
  });
  const flowEdges: { e: FlowEdge; s: number; t: number; i: number }[] = [];
  edges.forEach((e, i) => {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s === undefined || t === undefined) return;
    flowEdges.push({ e, s, t, i });
    if (s !== t) g.setEdge(`n${String(s)}`, `n${String(t)}`, { minlen: 1, weight: 1 }, `e${String(i)}`);
  });
  runLayout(g);

  nodes.forEach((n, i) => {
    const d = g.node(`n${String(i)}`);
    n.fx = d.x ?? 0;
    n.fy = d.y ?? 0;
    // The shape is in the middle of its cell.
    const sx = n.fx;
    const sy = n.fy;
    n.shape = { x: sx - n.shape.w / 2, y: sy - n.shape.h / 2, w: n.shape.w, h: n.shape.h };
  });

  // Ranks: the distinct x positions of cells and of dagre's bends. Corridors lie between the widest cell of a rank and the next.
  const xs = new Set<number>();
  const key = (x: number): number => Math.round(x * 100) / 100;
  for (const n of nodes) xs.add(key(n.fx));
  const innerOf = new Map<number, Pt[]>();
  for (const f of flowEdges) {
    if (f.s === f.t) continue;
    const pts: Pt[] = g.edge(`n${String(f.s)}`, `n${String(f.t)}`, `e${String(f.i)}`).points ?? [];
    const inner = pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
    innerOf.set(f.i, inner);
    for (const p of inner) xs.add(key(p.x));
  }
  const ranks = [...xs].sort((a, b) => a - b);
  const rankOf = (x: number): number => {
    const k = key(x);
    let best = 0;
    for (let i = 0; i < ranks.length; i++) if (Math.abs((ranks[i] ?? 0) - k) < Math.abs((ranks[best] ?? 0) - k)) best = i;
    return best;
  };
  const half = ranks.map(() => 0);
  for (const n of nodes) {
    const r = rankOf(n.fx);
    half[r] = Math.max(half[r] ?? 0, n.fw / 2);
  }
  const corridor = (i: number): number => {
    const a = (ranks[i] ?? 0) + (half[i] ?? 0);
    const b = (ranks[i + 1] ?? a + RANK_SEP) - (half[i + 1] ?? 0);
    return (a + b) / 2;
  };
  const top = nodes.reduce((m, n) => Math.min(m, n.fy - n.fh / 2, n.shape.y), Infinity);
  let backCount = 0;
  const framePaths = new Map<number, Pt[]>();
  for (const f of flowEdges) {
    const s = nodes[f.s];
    const t = nodes[f.t];
    if (!s || !t) continue;
    const sc = { x: s.shape.x + s.shape.w / 2, y: s.shape.y + s.shape.h / 2 };
    const tc = { x: t.shape.x + t.shape.w / 2, y: t.shape.y + t.shape.h / 2 };
    if (f.s === f.t) {
      const yTop = s.shape.y - 16;
      framePaths.set(f.i, [{ x: sc.x - 8, y: s.shape.y }, { x: sc.x - 8, y: yTop }, { x: sc.x + 8, y: yTop }, { x: sc.x + 8, y: s.shape.y }]);
      continue;
    }
    const rs = rankOf(s.fx);
    const rt = rankOf(t.fx);
    if (rt <= rs) {
      const yc = top - BACK_CHANNEL - 8 * backCount++;
      framePaths.set(f.i, simplify([{ x: sc.x, y: s.shape.y }, { x: sc.x, y: yc }, { x: tc.x, y: yc }, { x: tc.x, y: t.shape.y }]));
      continue;
    }
    const path: Pt[] = [{ x: s.shape.x + s.shape.w, y: sc.y }];
    let lastY = sc.y;
    let cur = rs;
    for (const p of innerOf.get(f.i) ?? []) {
      const rp = rankOf(p.x);
      if (rp <= cur) continue;
      const jx = corridor(cur);
      path.push({ x: jx, y: lastY }, { x: jx, y: p.y }, { x: ranks[rp] ?? p.x, y: p.y });
      lastY = p.y;
      cur = rp;
    }
    const jx = Math.min(corridor(Math.min(cur, ranks.length - 2)), t.shape.x - 6);
    path.push({ x: jx, y: lastY }, { x: jx, y: tc.y }, { x: t.shape.x, y: tc.y });
    framePaths.set(f.i, simplify(path));
  }

  const flip = (p: Pt): Pt => (tb ? { x: p.y, y: p.x } : p);
  const flipRect = (r: Rect): Rect => (tb ? { x: r.y, y: r.x, w: r.h, h: r.w } : r);
  const shapes = new Map<string, Rect>();
  const cellRects = new Map<string, Rect>();
  const paths = new Map<string, Pt[]>();
  nodes.forEach((n) => {
    shapes.set(n.id, flipRect(n.shape));
    cellRects.set(n.id, flipRect({ x: n.fx - n.fw / 2, y: n.fy - n.fh / 2, w: n.fw, h: n.fh }));
  });
  for (const f of flowEdges) paths.set(f.e.key, (framePaths.get(f.i) ?? []).map(flip));

  // Move everything so the bounding box starts at the origin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const r of cellRects.values()) {
    grow(r.x, r.y);
    grow(r.x + r.w, r.y + r.h);
  }
  for (const r of shapes.values()) {
    grow(r.x, r.y);
    grow(r.x + r.w, r.y + r.h);
  }
  for (const p of paths.values()) for (const q of p) grow(q.x, q.y);
  if (!Number.isFinite(minX)) return { shapes, cells: cellRects, paths, width: 0, height: 0 };
  const mv = (r: Rect): Rect => ({ x: r.x - minX, y: r.y - minY, w: r.w, h: r.h });
  for (const [k, r] of shapes) shapes.set(k, mv(r));
  for (const [k, r] of cellRects) cellRects.set(k, mv(r));
  for (const [k, p] of paths) paths.set(k, p.map((q) => ({ x: q.x - minX, y: q.y - minY })));
  return { shapes, cells: cellRects, paths, width: maxX - minX, height: maxY - minY };
}

