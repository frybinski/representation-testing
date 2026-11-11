import type { ModelEdge, ModelNode, ProcessModel } from '../model.js';
import {
  CELL_PAD,
  DRAWN_BPMN,
  DRAWN_BPMN_EDGES,
  SUB_PAD,
  boxSpec,
  headerLayout,
  indexOf,
  labelOf,
  shapeKindOf,
  subProcessHeader,
  type BpmnIndex,
} from './bpmn-common.js';
import { layoutFlow, type Direction, type FlowCell, type FlowEdge } from './flow-layout.js';
import { boundaryPoint, pathCrosses, simplify, translate } from './geometry.js';
import { emptyScene, EDGE_FONT, type Scene } from './scene.js';
import { textWidth } from './metrics.js';
import { cx, cy, type Pt, type Rect } from './svg.js';

interface Level {
  shapes: Map<string, Rect>;
  cells: Map<string, Rect>;
  paths: Map<string, Pt[]>;
  width: number;
  height: number;
  /** Layout of the children of each expanded sub-process, relative to the content area of that sub-process. */
  inner: Map<string, Level>;
  edges: ModelEdge[];
}

const LANE_ROW_PAD = 16;
const STACK_GAP = 20;
const POOL_PAD_X = 20;
const POOL_PAD_Y = 24;
const POOL_GAP = 40;
const BLACKBOX_H = 60;
const MSG_CHANNEL = 6;

const CONTENT_NOT = new Set(['participant', 'lane']);

/**
 * Automatic layered layout of a BPMN model (docs/diagram.md). Each level (process, expanded sub-process) is laid out on its own with
 * dagre; lanes re-stack the nodes of a pool into rows; pools are stacked and message flows run through the gaps between them.
 * Sub-processes that have children are always drawn expanded. With pools or lanes the direction is left to right whatever `direction` says.
 */
export function bpmnAutoScene(model: ProcessModel, direction: Direction, fallback: string): Scene {
  const idx = indexOf(model);
  const scene = emptyScene('auto', fallback);
  const hasPools = model.nodes.some((n) => n.type === 'participant' || n.type === 'lane');
  const dir: Direction = hasPools ? 'LR' : direction;

  const content = (parentId: string): ModelNode[] =>
    (idx.children.get(parentId) ?? []).filter((n) => DRAWN_BPMN.has(n.type) && !CONTENT_NOT.has(n.type));
  const isContainer = (n: ModelNode): boolean => n.type === 'subProcess' && content(n.id).length > 0;

  function edgesAmong(ids: ReadonlySet<string>): ModelEdge[] {
    return model.edges.filter((e) => DRAWN_BPMN_EDGES.has(e.type) && e.type !== 'messageFlow' && ids.has(e.source) && ids.has(e.target));
  }

  function layoutLevel(nodes: ModelNode[]): Level {
    const ids = new Set(nodes.map((n) => n.id));
    const inner = new Map<string, Level>();
    const cells: FlowCell[] = nodes.map((n) => {
      if (isContainer(n)) {
        const lv = layoutLevel(content(n.id));
        inner.set(n.id, lv);
        const label = labelOf(n);
        const w0 = Math.max(100, lv.width + 2 * SUB_PAD);
        const head = subProcessHeader(label, w0);
        const w = Math.max(w0, ...head.lines.map((l) => textWidth(l, 12) + 2 * CELL_PAD));
        return { id: n.id, shapeW: w, shapeH: Math.max(80, lv.height + head.height + SUB_PAD), labelW: 0, labelH: 0 };
      }
      const b = boxSpec(n);
      return { id: n.id, shapeW: b.shapeW, shapeH: b.shapeH, labelW: b.belowW, labelH: b.belowH };
    });
    const edges = edgesAmong(ids);
    const flowEdges: FlowEdge[] = edges.map((e) => ({
      key: e.key,
      source: e.source,
      target: e.target,
      labelW: e.name ? textWidth(e.name, EDGE_FONT) : 0,
    }));
    const lay = layoutFlow(cells, flowEdges, dir);
    return { shapes: lay.shapes, cells: lay.cells, paths: lay.paths, width: lay.width, height: lay.height, inner, edges };
  }

  function commit(level: Level, ox: number, oy: number): void {
    for (const [id, r] of level.shapes) scene.nodes.set(id, { rect: { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h } });
    for (const [key, p] of level.paths) scene.edges.set(key, { points: translate(p, ox, oy) });
    for (const [id, lv] of level.inner) {
      const r = level.shapes.get(id);
      const n = idx.byId.get(id);
      if (!r || !n) continue;
      scene.containers.add(id);
      commit(lv, ox + r.x + SUB_PAD, oy + r.y + subProcessHeader(labelOf(n), r.w).height);
    }
  }

  // ---- regions: one per participant, plus one per process no participant refers to ----
  interface Region {
    pool: ModelNode | undefined;
    process: ModelNode | undefined;
  }
  const regions: Region[] = [];
  const used = new Set<string>();
  for (const n of model.nodes) {
    if (n.type !== 'participant') continue;
    const ref = n.attributes.processRef;
    const proc = typeof ref === 'string' ? idx.byId.get(ref) : undefined;
    if (proc?.type === 'process') used.add(proc.id);
    regions.push({ pool: n, process: proc?.type === 'process' ? proc : undefined });
  }
  for (const n of model.nodes) if (n.type === 'process' && !used.has(n.id)) regions.push({ pool: undefined, process: n });

  const regionOf = new Map<string, number>();
  const placedRegions: { top: number; bottom: number; left: number; right: number }[] = [];
  let y = 0;
  let poolW = 0;
  interface Pending {
    region: Region;
    level: Level | undefined;
    lanes: LaneGeometry | undefined;
    height: number;
  }
  const pending: Pending[] = [];
  for (const region of regions) {
    if (!region.process) {
      pending.push({ region, level: undefined, lanes: undefined, height: BLACKBOX_H });
      continue;
    }
    const level = layoutLevel(content(region.process.id));
    const lanes = packLanes(region.process, level, idx);
    pending.push({ region, level, lanes, height: lanes ? lanes.height : level.height + 2 * POOL_PAD_Y });
  }

  // widths: pool header, lane headers, padding and content
  const widths = pending.map((p) => {
    const poolHeader = p.region.pool ? headerLayout(labelOf(p.region.pool), p.height).size : 0;
    const laneHeaders = p.lanes ? p.lanes.headerTotal : 0;
    const padX = p.region.pool || p.lanes ? POOL_PAD_X : 0;
    return { poolHeader, laneHeaders, padX, width: poolHeader + laneHeaders + 2 * padX + (p.level?.width ?? 0) };
  });
  poolW = Math.max(0, ...widths.map((w, i) => (pending[i]?.region.pool || pending[i]?.lanes ? w.width : 0)));

  pending.forEach((p, i) => {
    const w = widths[i];
    if (!w) return;
    const framed = p.region.pool !== undefined || p.lanes !== undefined;
    const regionW = framed ? Math.max(poolW, w.width) : w.width;
    const x0 = w.poolHeader + w.laneHeaders + w.padX;
    const regionIdx = i;
    if (p.region.pool) {
      scene.nodes.set(p.region.pool.id, { rect: { x: 0, y, w: regionW, h: p.height } });
      scene.headerSize.set(p.region.pool.id, w.poolHeader);
      regionOf.set(p.region.pool.id, regionIdx);
    }
    if (p.region.process) regionOf.set(p.region.process.id, regionIdx);
    if (p.level) {
      commit(p.level, x0, p.lanes ? y : y + (framed ? POOL_PAD_Y : 0));
      if (p.lanes) {
        for (const [pid, r] of p.lanes.rerouted) scene.edges.set(pid, { points: translate(r, x0, y) });
        for (const lane of p.lanes.lanes) {
          const left = w.poolHeader + lane.leftOffset;
          scene.nodes.set(lane.id, { rect: { x: left, y: y + lane.top, w: regionW - left, h: lane.bottom - lane.top } });
          scene.headerSize.set(lane.id, lane.headerSize);
          regionOf.set(lane.id, regionIdx);
        }
      }
    }
    placedRegions.push({ top: y, bottom: y + p.height, left: 0, right: regionW });
    y += p.height + (p.region.pool ? POOL_GAP : 50);
  });

  // nodes below a process belong to its region
  const regionIndexOfNode = (id: string): number | undefined => {
    let cur = idx.byId.get(id);
    let guard = 0;
    while (cur && guard++ < 1000) {
      const r = regionOf.get(cur.id);
      if (r !== undefined) return r;
      cur = cur.parent === undefined ? undefined : idx.byId.get(cur.parent);
    }
    return undefined;
  };

  routeMessageFlows(model, scene, placedRegions, regionIndexOfNode);
  routeRemaining(model, scene, idx);

  // model order
  const ordered = new Map<string, { rect: Rect }>();
  for (const n of model.nodes) {
    const s = scene.nodes.get(n.id);
    if (s) ordered.set(n.id, s);
  }
  scene.nodes = ordered;
  const orderedEdges = new Map<string, { points: Pt[] }>();
  for (const e of model.edges) {
    const s = scene.edges.get(e.key);
    if (s) orderedEdges.set(e.key, s);
  }
  scene.edges = orderedEdges;
  return scene;
}

// ---- lanes -------------------------------------------------------------

interface LaneGeometry {
  lanes: { id: string; depth: number; top: number; bottom: number; leftOffset: number; headerSize: number }[];
  /** Sum of the widest label band of each lane depth. */
  headerTotal: number;
  height: number;
  /** Routes of all edges of the level in level coordinates (rows start at y = 0). */
  rerouted: Map<string, Pt[]>;
}

/**
 * Re-stacks the cells of a level into one row per lane (a lane with child lanes also gets a row for its own members) and routes the
 * edges again, because the rows move cells away from the positions dagre computed. Mutates `level`.
 */
function packLanes(process: ModelNode, level: Level, idx: BpmnIndex): LaneGeometry | undefined {
  const lanesOf = (parentId: string): ModelNode[] => (idx.children.get(parentId) ?? []).filter((n) => n.type === 'lane');
  const top = lanesOf(process.id);
  if (top.length === 0) return undefined;
  const inLevel = new Set(level.shapes.keys());
  const assigned = new Set<string>();
  interface Row {
    lane: string | null;
    ids: string[];
  }
  const span = new Map<string, { from: number; to: number; depth: number }>();
  const rows: Row[] = [];
  const memberIds = (lane: ModelNode): string[] => (Array.isArray(lane.attributes.flowNodeRefs) ? lane.attributes.flowNodeRefs.map(String) : []);
  const descendantMembers = (lane: ModelNode): Set<string> => {
    const out = new Set<string>();
    for (const k of lanesOf(lane.id)) {
      for (const m of memberIds(k)) out.add(m);
      for (const m of descendantMembers(k)) out.add(m);
    }
    return out;
  };
  const build = (lane: ModelNode, depth: number): void => {
    const from = rows.length;
    const kids = lanesOf(lane.id);
    const deeper = descendantMembers(lane);
    // The lane's own row holds the members that no child lane claims.
    const own = memberIds(lane).filter((m) => inLevel.has(m) && !deeper.has(m) && !assigned.has(m));
    for (const m of own) assigned.add(m);
    if (own.length > 0 || kids.length === 0) rows.push({ lane: lane.id, ids: own });
    for (const k of kids) build(k, depth + 1);
    span.set(lane.id, { from, to: Math.max(from, rows.length - 1), depth });
  };
  for (const l of top) build(l, 0);
  const rest = [...level.shapes.keys()].filter((id) => !assigned.has(id));
  if (rest.length > 0) rows.push({ lane: null, ids: rest });

  // back edges (target not to the right of the source) need a channel above the first row
  const kind = (id: string): Rect => level.shapes.get(id) ?? { x: 0, y: 0, w: 0, h: 0 };
  const isBack = (e: ModelEdge): boolean => {
    const s = kind(e.source);
    const t = kind(e.target);
    return !(t.x > s.x + s.w + 8);
  };
  const backCount = level.edges.filter(isBack).length;
  const extraTop = (backCount > 0 ? 10 + 6 * backCount : 0) + 12;

  const rowTop: number[] = [];
  const rowHeight: number[] = [];
  let cursor = 0;
  rows.forEach((row, ri) => {
    const groups = new Map<number, string[]>();
    for (const id of row.ids) {
      const c = level.cells.get(id);
      if (!c) continue;
      const k = Math.round(cx(c));
      const g = groups.get(k);
      if (g) g.push(id);
      else groups.set(k, [id]);
    }
    const stacks = [...groups.values()].map((g) => {
      g.sort((a, b) => (level.cells.get(a)?.y ?? 0) - (level.cells.get(b)?.y ?? 0));
      return { g, h: g.reduce((s, id) => s + (level.cells.get(id)?.h ?? 0), 0) + STACK_GAP * (g.length - 1) };
    });
    const pad = ri === 0 ? extraTop : 0;
    const inner = Math.max(0, ...stacks.map((s) => s.h));
    const h = Math.max(80, inner + 2 * LANE_ROW_PAD) + pad;
    rowTop.push(cursor);
    rowHeight.push(h);
    for (const s of stacks) {
      let yy = cursor + pad + (h - pad - s.h) / 2;
      for (const id of s.g) {
        const cell = level.cells.get(id);
        const shape = level.shapes.get(id);
        if (!cell || !shape) continue;
        const dy = yy - cell.y;
        level.cells.set(id, { ...cell, y: yy });
        level.shapes.set(id, { ...shape, y: shape.y + dy });
        yy += cell.h + STACK_GAP;
      }
    }
    cursor += h;
  });
  const height = cursor;

  // lane bands
  const lanes: LaneGeometry['lanes'] = [];
  const depthWidth: number[] = [];
  const raw = [...span.entries()].map(([id, s]) => {
    const t = rowTop[s.from] ?? 0;
    const b = (rowTop[s.to] ?? 0) + (rowHeight[s.to] ?? 0);
    const node = idx.byId.get(id);
    const size = headerLayout(node ? labelOf(node) : '', b - t).size;
    depthWidth[s.depth] = Math.max(depthWidth[s.depth] ?? 0, size);
    return { id, s, t, b, size };
  });
  const sumFrom = (d: number): number => depthWidth.slice(d).reduce((a, b) => a + b, 0);
  for (const r of raw) {
    const leaf = lanesOf(r.id).length === 0;
    lanes.push({
      id: r.id,
      depth: r.s.depth,
      top: r.t,
      bottom: r.b,
      leftOffset: depthWidth.slice(0, r.s.depth).reduce((a, b) => a + b, 0),
      headerSize: leaf ? sumFrom(r.s.depth) : (depthWidth[r.s.depth] ?? r.size),
    });
  }

  // routes
  const rerouted = new Map<string, Pt[]>();
  const cellList = [...level.cells.entries()];
  const contentTop = Math.min(...[...level.cells.values()].map((c) => c.y), 0);
  let channel = 0;
  for (const e of level.edges) {
    const s = level.shapes.get(e.source);
    const t = level.shapes.get(e.target);
    if (!s || !t) continue;
    const obstacles = cellList.filter(([id]) => id !== e.source && id !== e.target).map(([, c]) => c);
    const route = routeBetween(s, t, obstacles, contentTop, channel);
    if (route.channelUsed) channel++;
    rerouted.set(e.key, route.points);
  }
  return { lanes, headerTotal: depthWidth.reduce((a, b) => a + b, 0), height, rerouted };
}

function routeBetween(s: Rect, t: Rect, obstacles: Rect[], contentTop: number, channelIndex: number): { points: Pt[]; channelUsed: boolean } {
  const sc = { x: cx(s), y: cy(s) };
  const tc = { x: cx(t), y: cy(t) };
  const yc = Math.max(2, contentTop - 8 - 6 * (channelIndex % 4));
  if (t.x > s.x + s.w + 8) {
    const sx = s.x + s.w;
    const tx = t.x;
    const sy = sc.y;
    const ty = tc.y;
    const mxs = [Math.max(sx + 8, tx - 24), Math.min(tx - 8, sx + 24)];
    for (const mx of mxs) {
      const p = simplify([{ x: sx, y: sy }, { x: mx, y: sy }, { x: mx, y: ty }, { x: tx, y: ty }]);
      if (!obstacles.some((o) => pathCrosses(p, o))) return { points: p, channelUsed: false };
    }
    return {
      points: simplify([
        { x: sx, y: sy },
        { x: sx + 14, y: sy },
        { x: sx + 14, y: yc },
        { x: tx - 14, y: yc },
        { x: tx - 14, y: ty },
        { x: tx, y: ty },
      ]),
      channelUsed: true,
    };
  }
  if (s === t) return { points: [{ x: sc.x - 8, y: s.y }, { x: sc.x - 8, y: s.y - 14 }, { x: sc.x + 8, y: s.y - 14 }, { x: sc.x + 8, y: s.y }], channelUsed: false };
  // Back edge: first a channel just above or below the two shapes, then the channel above all shapes.
  for (const yl of [Math.min(s.y, t.y) - 12, Math.max(s.y + s.h, t.y + t.h) + 12]) {
    const p = simplify([
      { x: sc.x, y: yl < s.y ? s.y : s.y + s.h },
      { x: sc.x, y: yl },
      { x: tc.x, y: yl },
      { x: tc.x, y: yl < t.y ? t.y : t.y + t.h },
    ]);
    if (!obstacles.some((o) => pathCrosses(p, o))) return { points: p, channelUsed: false };
  }
  return { points: simplify([{ x: sc.x, y: s.y }, { x: sc.x, y: yc }, { x: tc.x, y: yc }, { x: tc.x, y: t.y }]), channelUsed: true };
}

// ---- edges across levels and pools ---------------------------------------

function routeMessageFlows(
  model: ProcessModel,
  scene: Scene,
  regions: { top: number; bottom: number; left: number; right: number }[],
  regionOfNode: (id: string) => number | undefined,
): void {
  const used = new Map<number, number>();
  for (const e of model.edges) {
    if (e.type !== 'messageFlow') continue;
    const s = scene.nodes.get(e.source)?.rect;
    const t = scene.nodes.get(e.target)?.rect;
    const rs = regionOfNode(e.source);
    const rt = regionOfNode(e.target);
    if (!s || !t || rs === undefined || rt === undefined) continue;
    const reg = regions[rs];
    if (!reg) continue;
    if (rs === rt) {
      const a = boundaryPoint('rect', s, { x: cx(t), y: cy(t) });
      const b = boundaryPoint('rect', t, { x: cx(s), y: cy(s) });
      scene.edges.set(e.key, { points: [a, b] });
      continue;
    }
    const down = rt > rs;
    const gapKey = down ? rs : -rs - 1;
    const k = used.get(gapKey) ?? 0;
    used.set(gapKey, k + 1);
    const ym = down ? reg.bottom + POOL_GAP / 2 + MSG_CHANNEL * (k % 4) - 9 : reg.top - POOL_GAP / 2 - MSG_CHANNEL * (k % 4) + 9;
    const sx = cx(s);
    const targetRegion = regions[rt];
    const blackBox = targetRegion !== undefined && Math.abs(t.h - (targetRegion.bottom - targetRegion.top)) < 0.5 && Math.abs(t.w - (targetRegion.right - targetRegion.left)) < 0.5;
    const tx = blackBox ? Math.min(Math.max(sx, t.x + 40), t.x + t.w - 40) : cx(t);
    const startY = down ? s.y + s.h : s.y;
    const endY = down ? t.y : t.y + t.h;
    scene.edges.set(e.key, { points: simplify([{ x: sx, y: startY }, { x: sx, y: ym }, { x: tx, y: ym }, { x: tx, y: endY }]) });
  }
}

function routeRemaining(model: ProcessModel, scene: Scene, idx: BpmnIndex): void {
  for (const e of model.edges) {
    if (!DRAWN_BPMN_EDGES.has(e.type) || scene.edges.has(e.key)) continue;
    const s = scene.nodes.get(e.source)?.rect;
    const t = scene.nodes.get(e.target)?.rect;
    const sn = idx.byId.get(e.source);
    const tn = idx.byId.get(e.target);
    if (!s || !t || !sn || !tn) continue;
    scene.edges.set(e.key, {
      points: [boundaryPoint(shapeKindOf(sn.type), s, { x: cx(t), y: cy(t) }), boundaryPoint(shapeKindOf(tn.type), t, { x: cx(s), y: cy(s) })],
    });
  }
}
