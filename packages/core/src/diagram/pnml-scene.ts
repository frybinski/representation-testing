import type { ModelNode, ProcessModel } from '../model.js';
import { layoutIndex, numbers, waypointsOf } from './bpmn-common.js';
import { layoutFlow, type Direction, type FlowCell, type FlowEdge } from './flow-layout.js';
import { boundaryPoint, simplify, type ShapeKind } from './geometry.js';
import { normalizeLabel, textWidth, wrapText } from './metrics.js';
import { emptyScene, EDGE_FONT, FONT, LINE, type Scene, type SceneResult } from './scene.js';
import { cx, cy, type Pt, type Rect } from './svg.js';

export const PLACE_SIZE = 40;
export const TRANSITION_W = 40;
export const TRANSITION_H = 40;
const BELOW_WRAP = 100;

export const isDrawnPetri = (n: ModelNode): boolean => n.type === 'place' || n.type === 'transition';
export const petriShape = (n: ModelNode): ShapeKind => (n.type === 'place' ? 'ellipse' : 'rect');

export interface BelowLine {
  text: string;
  role: 'label' | 'final';
}

/** Marking written below a place: the final marking of a pm4py net, one line per final marking with tokens (docs/diagram.md). */
export function finalMarkingLines(n: ModelNode): string[] {
  const finals = Array.isArray(n.attributes.finalMarkings) ? n.attributes.finalMarkings : [];
  const out: string[] = [];
  finals.forEach((tokens, i) => {
    if (typeof tokens !== 'number' || tokens <= 0) return;
    out.push(finals.length > 1 ? `final m${String(i + 1)}: ${String(tokens)}` : `final: ${String(tokens)}`);
  });
  return out;
}

/** Lines below the shape of a place or transition: the wrapped name, then the final marking lines. */
export function belowLines(n: ModelNode): BelowLine[] {
  const out: BelowLine[] = [];
  const name = n.name === undefined ? '' : normalizeLabel(n.name);
  if (name !== '') for (const t of wrapText(name, FONT, BELOW_WRAP)) out.push({ text: t, role: 'label' });
  for (const t of finalMarkingLines(n)) out.push({ text: t, role: 'final' });
  return out;
}

/** Scene from PNML graphics: `position` is the centre of the node (assumption, H53), `dimension` its width and height. */
export function pnmlFileScene(model: ProcessModel): SceneResult {
  const lay = layoutIndex(model);
  const scene = emptyScene('file');
  for (const n of model.nodes) {
    if (!isDrawnPetri(n)) continue;
    const pos = numbers(lay.get(n.id)?.get('position'), 2);
    const dim = numbers(lay.get(n.id)?.get('dimension'), 2);
    if (!pos || !dim || (dim[0] ?? 0) <= 0 || (dim[1] ?? 0) <= 0) return { ok: false, reason: `no position and dimension for ${n.type} "${n.id}"` };
    const w = dim[0] ?? 0;
    const h = dim[1] ?? 0;
    scene.nodes.set(n.id, { rect: { x: (pos[0] ?? 0) - w / 2, y: (pos[1] ?? 0) - h / 2, w, h } });
  }
  if (scene.nodes.size === 0) return { ok: false, reason: 'the file has no places or transitions with graphics' };
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const e of model.edges) {
    const s = scene.nodes.get(e.source)?.rect;
    const t = scene.nodes.get(e.target)?.rect;
    const sn = byId.get(e.source);
    const tn = byId.get(e.target);
    if (!s || !t || !sn || !tn) continue;
    const bends = waypointsOf(lay.get(e.key)?.get('waypoints')) ?? [];
    const first = bends[0] ?? { x: cx(t), y: cy(t) };
    const last = bends[bends.length - 1] ?? { x: cx(s), y: cy(s) };
    scene.edges.set(e.key, {
      points: simplify([boundaryPoint(petriShape(sn), s, first), ...bends, boundaryPoint(petriShape(tn), t, last)]),
    });
  }
  return { ok: true, scene };
}

export function pnmlAutoScene(model: ProcessModel, direction: Direction, fallback: string): Scene {
  const scene = emptyScene('auto', fallback);
  const nodes = model.nodes.filter(isDrawnPetri);
  const cells: FlowCell[] = nodes.map((n) => {
    const lines = belowLines(n);
    const size = n.type === 'place' ? { w: PLACE_SIZE, h: PLACE_SIZE } : { w: TRANSITION_W, h: TRANSITION_H };
    return {
      id: n.id,
      shapeW: size.w,
      shapeH: size.h,
      labelW: Math.max(0, ...lines.map((l) => textWidth(l.text, FONT))),
      labelH: lines.length * LINE,
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = model.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ key: e.key, source: e.source, target: e.target, labelW: typeof e.attributes.weight === 'number' && e.attributes.weight !== 1 ? textWidth(String(e.attributes.weight), EDGE_FONT) : 0 }));
  const lay = layoutFlow(cells, edges, direction);
  for (const n of nodes) {
    const r = lay.shapes.get(n.id);
    if (r) scene.nodes.set(n.id, { rect: r });
  }
  for (const e of edges) {
    const p: Pt[] | undefined = lay.paths.get(e.key);
    if (p) scene.edges.set(e.key, { points: p });
  }
  return scene;
}

export type { Rect };
