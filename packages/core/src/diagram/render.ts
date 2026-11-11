import { makeFact } from '../facts.js';
import type { Fact, FactCategory, ModelEdge, ModelNode, ProcessModel } from '../model.js';
import {
  CELL_PAD,
  DRAWN_BPMN,
  EVENT_NODE_TYPES,
  GATEWAY_TYPES,

  headerLayout,
  indexOf,
  labelOf,
  layoutIndex,
  numbers,
  shapeClassOf,
  subProcessHeader,
  type BpmnIndex,
} from './bpmn-common.js';
import { BAND, EVENT_GLYPHS, INK, PAPER, eventGlyph, gatewayGlyph, multipleGlyph, taskGlyph } from './glyphs.js';

import { normalizeLabel, wrapText } from './metrics.js';
import { belowLines, finalMarkingLines, isDrawnPetri } from './pnml-scene.js';
import { EDGE_FONT, FONT, LINE, type Scene } from './scene.js';
import { cx, cy, esc, num, pathOf, type Pt, type Rect } from './svg.js';
import { textWidth } from './metrics.js';

export type Encoding = 'text' | 'visual';

export interface RenderOptions {
  /** Write the condition expression of sequence flows next to the flow (otherwise only the name). */
  showConditions: boolean;
}

export interface Rendered {
  svg: string;
  width: number;
  height: number;
  /** Fact id to the way the diagram carries the fact. Only facts the model has appear here. */
  encoding: Map<string, Encoding>;
}

const MARGIN = 20;

/** Collects carried facts; a fact is accepted only if the model has it, as in `Carrier`. */
class Marks {
  private readonly known: Set<string>;
  readonly map = new Map<string, Encoding>();
  constructor(model: ProcessModel) {
    this.known = new Set(model.facts.map((f) => f.id));
  }
  private put(how: Encoding, category: FactCategory, subject: string, aspect: string, value: string): void {
    const id = makeFact(category, subject, aspect, value).id;
    if (this.known.has(id) && !this.map.has(id)) this.map.set(id, how);
  }
  text(category: FactCategory, subject: string, aspect: string, value: string): void {
    this.put('text', category, subject, aspect, value);
  }
  visual(category: FactCategory, subject: string, aspect: string, value: string): void {
    this.put('visual', category, subject, aspect, value);
  }
}

class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  add(x: number, y: number): void {
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }
  rect(r: Rect): void {
    this.add(r.x, r.y);
    this.add(r.x + r.w, r.y + r.h);
  }
}

const HALO = ' stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"';

const sw = (n: number): string => ` stroke-width="${num(n)}"`;

/** `<text>` with one `<tspan>` per line; every tspan has absolute coordinates, so the text does not depend on the viewer's line breaking. */
function textBlock(lines: readonly string[], x: number, firstBaseline: number, anchor: 'start' | 'middle' | 'end', cls: string, size = FONT, extra = ''): string {
  if (lines.length === 0) return '';
  const spans = lines.map((l, i) => `<tspan x="${num(x)}" y="${num(firstBaseline + i * LINE)}">${esc(l)}</tspan>`).join('');
  return `<text class="${cls}" text-anchor="${anchor}"${size === FONT ? '' : ` font-size="${num(size)}"`}${extra}>${spans}</text>`;
}

/** Lines of text centred vertically on `centerY`. */
function centeredBaseline(count: number, centerY: number): number {
  return centerY - (count * LINE) / 2 + 10.5;
}

const DEFS = `<defs><marker id="rb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 1L10 5L0 9Z" fill="${INK}" stroke="${INK}" stroke-linejoin="round"/></marker><marker id="rb-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="${INK}" stroke-linejoin="round"/></marker><marker id="rb-msg-start" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><circle cx="5" cy="5" r="3.5" fill="${PAPER}" stroke="${INK}"/></marker><marker id="rb-default" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M3 9L7 1" stroke="${INK}"/></marker><marker id="rb-cond" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="14" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 5L7 1L13 5L7 9Z" fill="${PAPER}" stroke="${INK}" stroke-linejoin="round"/></marker></defs>`;

function edgeStyle(type: ModelEdge['type']): { dash: string; start: string; end: string } {
  switch (type) {
    case 'messageFlow':
      return { dash: ' stroke-dasharray="7 4"', start: 'url(#rb-msg-start)', end: 'url(#rb-arrow-open)' };
    case 'association':
      return { dash: ' stroke-dasharray="2 3"', start: '', end: '' };
    case 'dataInputAssociation':
    case 'dataOutputAssociation':
      return { dash: ' stroke-dasharray="2 3"', start: '', end: 'url(#rb-arrow-open)' };
    default:
      return { dash: '', start: '', end: 'url(#rb-arrow)' };
  }
}

function edgeGroup(e: ModelEdge, points: readonly Pt[], lines: readonly string[], bounds: Bounds, markers: { start?: string; end?: string } = {}): string {
  const st = edgeStyle(e.type);
  const start = markers.start ?? st.start;
  const end = markers.end ?? st.end;
  for (const p of points) bounds.add(p.x, p.y);
  let label = '';
  if (lines.length > 0) {
    const { at, horizontal } = labelAnchor(points, e.type === 'messageFlow');
    const widest = Math.max(...lines.map((l) => textWidth(l, EDGE_FONT)));
    if (horizontal) {
      const base = at.y - 6 - (lines.length - 1) * LINE;
      label = textBlock(lines, at.x, base, 'middle', 'rb-edge-label', EDGE_FONT, ' stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke" fill="#222222"');
      bounds.add(at.x - widest / 2, base - 10);
      bounds.add(at.x + widest / 2, at.y);
    } else {
      const base = at.y - ((lines.length - 1) * LINE) / 2 + 4;
      label = textBlock(lines, at.x + 6, base, 'start', 'rb-edge-label', EDGE_FONT, ' stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke" fill="#222222"');
      bounds.add(at.x + 6 + widest, at.y + (lines.length * LINE) / 2);
      bounds.add(at.x, at.y - (lines.length * LINE) / 2);
    }
  }
  const attrs = `${start ? ` marker-start="${start}"` : ''}${end ? ` marker-end="${end}"` : ''}`;
  return `<g class="rb-edge rb-${e.type}" data-element="${esc(e.key)}" data-kind="edge" data-type="${e.type}"><path d="${pathOf(points)}" fill="none" stroke="${INK}"${sw(1.5)}${st.dash}${attrs}/>${label}</g>`;
}

/** Where an edge label goes: the middle of the longest horizontal stretch, else of the longest stretch (a long message flow: near its start). */
function labelAnchor(points: readonly Pt[], nearStart: boolean): { at: Pt; horizontal: boolean } {
  let best: { a: Pt; b: Pt; len: number; horizontal: boolean } | undefined;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const horizontal = Math.abs(b.y - a.y) < 0.5;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const score = (horizontal && len >= 40 ? 1e6 : 0) + len;
    const bestScore = best ? (best.horizontal && best.len >= 40 ? 1e6 : 0) + best.len : -1;
    if (score > bestScore) best = { a, b, len, horizontal };
  }
  if (!best) return { at: points[0] ?? { x: 0, y: 0 }, horizontal: true };
  const t = nearStart && !best.horizontal && best.len > 150 ? 24 / best.len : 0.5;
  return { at: { x: best.a.x + (best.b.x - best.a.x) * t, y: best.a.y + (best.b.y - best.a.y) * t }, horizontal: best.horizontal };
}

function wrapEdge(text: string): string[] {
  return text === '' ? [] : wrapText(text, EDGE_FONT, 110);
}

/** Whether the centre of `inner` lies inside `outer`. */
const centreInside = (outer: Rect, inner: Rect): boolean => cx(inner) >= outer.x && cx(inner) <= outer.x + outer.w && cy(inner) >= outer.y && cy(inner) <= outer.y + outer.h;

// ===========================================================================
// BPMN
// ===========================================================================

export function renderBpmn(model: ProcessModel, scene: Scene, options: RenderOptions): Rendered {
  const marks = new Marks(model);
  const bounds = new Bounds();
  const idx = indexOf(model);
  const lay = layoutIndex(model);
  const file = scene.source === 'file';
  const nodeRect = (id: string): Rect | undefined => scene.nodes.get(id)?.rect;

  // process id -> participant whose pool shows the process
  const poolOfProcess = new Map<string, ModelNode>();
  for (const n of model.nodes) {
    const ref = n.attributes.processRef;
    if (n.type === 'participant' && typeof ref === 'string' && scene.nodes.has(n.id)) poolOfProcess.set(ref, n);
  }
  const parentShown = (n: ModelNode, r: Rect): boolean => {
    if (n.parent === undefined) return false;
    if (scene.containers.has(n.parent)) {
      const pr = nodeRect(n.parent);
      return pr !== undefined && centreInside(pr, r);
    }
    const pool = poolOfProcess.get(n.parent);
    if (pool) {
      const pr = nodeRect(pool.id);
      return pr !== undefined && centreInside(pr, r);
    }
    return false;
  };

  /** Label below an event, gateway or data object, or where the file's label bounds put it. */
  const belowLabel = (n: ModelNode, r: Rect, label: string): string => {
    const lb = file ? numbers(lay.get(n.id)?.get('labelBounds'), 4) : null;
    const lines = wrapText(label, FONT, lb ? Math.max(96, lb[2] ?? 0) : 96);
    if (lines.length === 0) return '';
    const x = lb ? (lb[0] ?? 0) + (lb[2] ?? 0) / 2 : cx(r);
    const base = lb ? (lb[1] ?? 0) + 10.5 : r.y + r.h + 14;
    const wd = Math.max(...lines.map((l) => textWidth(l, FONT)));
    bounds.add(x - wd / 2, base - 10);
    bounds.add(x + wd / 2, base + (lines.length - 1) * LINE + 4);
    return textBlock(lines, x, base, 'middle', 'rb-label', FONT, HALO);
  };

  const containerParts: { order: number; area: number; svg: string }[] = [];
  const nodeParts: string[] = [];
  const edgeParts: string[] = [];

  const layoutFacts = (id: string, exact: boolean, extra: Record<string, boolean> = {}): void => {
    if (!file) return;
    const m = lay.get(id);
    if (!m) return;
    if (exact && m.has('bounds')) marks.visual('layout', id, 'bounds', m.get('bounds') ?? '');
    for (const [aspect, ok] of Object.entries(extra)) if (ok && m.has(aspect)) marks.visual('layout', id, aspect, m.get(aspect) ?? '');
  };

  for (const n of model.nodes) {
    const r = nodeRect(n.id);
    if (!r || !DRAWN_BPMN.has(n.type)) continue;
    bounds.rect(r);
    const cls = shapeClassOf(n.type);
    const label = labelOf(n);
    const g = (inner: string): string => `<g class="rb-node rb-${cls ?? 'node'}" data-element="${esc(n.id)}" data-kind="node" data-type="${n.type}">${inner}</g>`;

    if (cls === 'pool' || cls === 'lane') {
      const top = scene.topHeader.has(n.id);
      const bandLen = top ? r.w : r.h;
      const hdr = headerLayout(label, bandLen);
      const size = scene.headerSize.get(n.id) ?? hdr.size;
      const sep = top ? `<path d="M${num(r.x)} ${num(r.y + size)}H${num(r.x + r.w)}" stroke="${INK}"${sw(1.5)}/>` : `<path d="M${num(r.x + size)} ${num(r.y)}V${num(r.y + r.h)}" stroke="${INK}"${sw(1.5)}/>`;
      let text = '';
      if (hdr.lines.length > 0) {
        if (top) text = textBlock(hdr.lines, r.x + r.w / 2, centeredBaselineIn(hdr.lines.length, r.y + size / 2), 'middle', 'rb-label');
        else {
          const lines = hdr.lines
            .map((l, i) => `<tspan x="0" y="${num((i - (hdr.lines.length - 1) / 2) * LINE + 4)}">${esc(l)}</tspan>`)
            .join('');
          text = `<text class="rb-label" text-anchor="middle" transform="translate(${num(r.x + size / 2)} ${num(r.y + r.h / 2)}) rotate(-90)">${lines}</text>`;
        }
      }
      const body = `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="${cls === 'pool' ? PAPER : BAND}" stroke="${INK}"${sw(1.5)}/>${sep}${text}`;
      containerParts.push({ order: cls === 'pool' ? 0 : 1, area: r.w * r.h, svg: g(body) });
      if (cls === 'pool') {
        marks.visual('poolLane', n.id, 'kind', n.type);
        const proc = n.attributes.processRef;
        if (typeof proc === 'string' && (idx.children.get(proc) ?? []).some((c) => scene.nodes.has(c.id) && centreInside(r, scene.nodes.get(c.id)?.rect ?? r))) {
          marks.visual('poolLane', n.id, 'process', proc);
        }
      } else {
        marks.visual('poolLane', n.id, 'kind', n.type);
        // nesting: a lane inside a lane, or a lane inside the pool of its process
        if (n.parent !== undefined) {
          const pr = nodeRect(n.parent);
          const poolOf = poolOfProcess.get(n.parent);
          const pr2 = poolOf ? nodeRect(poolOf.id) : undefined;
          const outer = pr ?? pr2;
          if (outer && centreInside(outer, r)) marks.visual('poolLane', n.id, 'parent', n.parent);
        }
        const members = Array.isArray(n.attributes.flowNodeRefs) ? n.attributes.flowNodeRefs.map(String) : [];
        for (const m of members) {
          const mr = nodeRect(m);
          if (mr && centreInside(r, mr)) marks.visual('poolLane', n.id, 'member', m);
        }
      }
      if (label !== '') marks.text('label', n.id, '', n.name ?? '');
      layoutFacts(n.id, true, { isHorizontal: (lay.get(n.id)?.get('isHorizontal') === 'false') === top });
      continue;
    }

    if (cls === 'task' || cls === 'subProcess') {
      const isContainer = scene.containers.has(n.id);
      const markerOffset = n.type !== 'task' && n.type !== 'subProcess' ? 20 : 0;
      let body = `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="10" ry="10" fill="${isContainer ? BAND : PAPER}" stroke="${INK}"${sw(1.5)}/>`;
      if (isContainer) {
        const head = subProcessHeader(label, r.w);
        body += textBlock(head.lines, r.x + r.w / 2, r.y + 14, 'middle', 'rb-label');
        const parts = { order: 2, area: r.w * r.h, svg: g(body) };
        containerParts.push(parts);
      } else {
        const glyph = taskGlyph(n.type, r.x + 6, r.y + 6);
        if (glyph) body += glyph;
        if (n.type === 'subProcess') {
          const bx = cx(r) - 7;
          const by = r.y + r.h - 18;
          body += `<g class="rb-glyph rb-glyph-collapsed"><rect x="${num(bx)}" y="${num(by)}" width="14" height="14" fill="${PAPER}" stroke="${INK}"/><path d="M${num(bx + 3)} ${num(by + 7)}H${num(bx + 11)}M${num(bx + 7)} ${num(by + 3)}V${num(by + 11)}" stroke="${INK}"/></g>`;
        }
        const bottomReserve = n.type === 'subProcess' ? 18 : 0;
        const top = r.y + (glyph ? 0 : 0) + (markerOffset > 0 ? 0 : 0);
        const lines = wrapText(label, FONT, r.w - 2 * CELL_PAD);
        const area = { y: top + (glyph ? 8 : 0), h: r.h - (glyph ? 8 : 0) - bottomReserve };
        body += textBlock(lines, cx(r), centeredBaseline(lines.length, area.y + area.h / 2), 'middle', 'rb-label');
        nodeParts.push(g(body));
      }
      marks.visual('node', n.id, '', '');
      if (n.parent !== undefined && parentShown(n, r)) marks.visual('node', n.id, 'parent', n.parent);
      marks.visual('nodeType', n.id, '', n.type);
      if (label !== '') marks.text('label', n.id, '', n.name ?? '');
      const expandedValue = lay.get(n.id)?.get('isExpanded');
      layoutFacts(n.id, true, n.type === 'subProcess' ? { isExpanded: (expandedValue === 'true') === isContainer } : {});
      continue;
    }

    if (cls === 'event') {
      const defs = Array.isArray(n.attributes.eventDefinitions) ? n.attributes.eventDefinitions.map(String) : [];
      const filled = n.type === 'endEvent' || n.type === 'intermediateThrowEvent';
      const c = { x: cx(r), y: cy(r) };
      const rad = Math.min(r.w, r.h) / 2;
      const ring = (radius: number, width: number): string => `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(radius)}" fill="${PAPER}" stroke="${INK}"${sw(width)}/>`;
      let body = n.type === 'startEvent' ? ring(rad, 1.5) : n.type === 'endEvent' ? ring(rad, 4) : `${ring(rad, 1.5)}<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(rad - 4)}" fill="none" stroke="${INK}"${sw(1.5)}/>`;
      const only = defs.length === 1 ? defs[0] : undefined;
      if (only !== undefined && EVENT_GLYPHS.has(only)) body += eventGlyph(only, c.x, c.y, filled);
      else if (defs.length > 1) body += multipleGlyph(c.x, c.y, filled);
      body += belowLabel(n, r, label);
      nodeParts.push(g(body));
      marks.visual('node', n.id, '', '');
      if (n.parent !== undefined && parentShown(n, r)) marks.visual('node', n.id, 'parent', n.parent);
      // An intermediate catching event without a definition looks like a throwing one; the type is not carried then.
      const typeKnown = n.type !== 'intermediateCatchEvent' || defs.length > 0;
      if (typeKnown) marks.visual('nodeType', n.id, '', n.type);
      if (only !== undefined && EVENT_GLYPHS.has(only)) marks.visual('eventType', n.id, '', only);
      if (label !== '') marks.text('label', n.id, '', n.name ?? '');
      layoutFacts(n.id, Math.abs(r.w - r.h) < 0.01);
      continue;
    }

    if (cls === 'gateway') {
      const c = { x: cx(r), y: cy(r) };
      let body = `<polygon points="${num(c.x)},${num(r.y)} ${num(r.x + r.w)},${num(c.y)} ${num(c.x)},${num(r.y + r.h)} ${num(r.x)},${num(c.y)}" fill="${PAPER}" stroke="${INK}"${sw(1.5)} stroke-linejoin="round"/>`;
      body += gatewayGlyph(n.type, c.x, c.y);
      body += belowLabel(n, r, label);
      nodeParts.push(g(body));
      marks.visual('node', n.id, '', '');
      if (n.parent !== undefined && parentShown(n, r)) marks.visual('node', n.id, 'parent', n.parent);
      marks.visual('nodeType', n.id, '', n.type);
      if (label !== '') marks.text('label', n.id, '', n.name ?? '');
      layoutFacts(n.id, true);
      continue;
    }

    if (cls === 'data') {
      const x0 = r.x;
      const y0 = r.y;
      const ear = Math.min(12, r.w / 3);
      let body = `<path d="M${num(x0)} ${num(y0)}H${num(x0 + r.w - ear)}L${num(x0 + r.w)} ${num(y0 + ear)}V${num(y0 + r.h)}H${num(x0)}Z M${num(x0 + r.w - ear)} ${num(y0)}V${num(y0 + ear)}H${num(x0 + r.w)}" fill="${PAPER}" stroke="${INK}"${sw(1.5)} stroke-linejoin="round"/>`;
      body += belowLabel(n, r, label);
      nodeParts.push(g(body));
      marks.visual('dataObject', n.id, 'kind', n.type);
      if (n.parent !== undefined && parentShown(n, r)) marks.visual('dataObject', n.id, 'parent', n.parent);
      if (label !== '') marks.text('label', n.id, '', n.name ?? '');
      layoutFacts(n.id, true);
      continue;
    }

    // text annotation
    const lines = wrapText(label, FONT, r.w - 20);
    let body = `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="none" stroke="none"/><path d="M${num(r.x + 10)} ${num(r.y)}H${num(r.x)}V${num(r.y + r.h)}H${num(r.x + 10)}" fill="none" stroke="${INK}"${sw(1.5)}/>`;
    body += textBlock(lines, r.x + 10, r.y + 6 + 10.5, 'start', 'rb-label');
    nodeParts.push(g(body));
    marks.visual('annotation', n.id, 'kind', n.type);
    marks.text('annotation', n.id, 'text', typeof n.attributes.text === 'string' ? n.attributes.text : '');
    if (n.parent !== undefined && parentShown(n, r)) marks.visual('annotation', n.id, 'parent', n.parent);
    layoutFacts(n.id, true);
  }

  for (const e of model.edges) {
    const path = scene.edges.get(e.key);
    if (!path) continue;
    const lines: string[] = [];
    const markers: { start?: string; end?: string } = {};
    if (e.type === 'sequenceFlow') {
      const name = e.name === undefined ? '' : normalizeLabel(e.name);
      const cond = typeof e.attributes.condition === 'string' ? normalizeLabel(e.attributes.condition) : '';
      lines.push(...wrapEdge(name));
      if (options.showConditions && cond !== '') lines.push(...wrapEdge(`[${cond}]`));
      if (e.attributes.isDefault === true) markers.start = 'url(#rb-default)';
      else if (cond !== '' && idx.byId.get(e.source) && !GATEWAY_TYPES.has(idx.byId.get(e.source)?.type ?? 'task') && !EVENT_NODE_TYPES.has(idx.byId.get(e.source)?.type ?? 'task')) markers.start = 'url(#rb-cond)';
      marks.visual('sequenceFlow', e.key, '', '');
      if (name !== '') marks.text('sequenceFlowName', e.key, '', e.name ?? '');
      if (e.attributes.isDefault === true) marks.visual('defaultFlow', e.key, '', '');
      if (options.showConditions && cond !== '') marks.text('condition', e.key, '', String(e.attributes.condition));
    } else if (e.type === 'messageFlow') {
      lines.push(...wrapEdge(e.name === undefined ? '' : normalizeLabel(e.name)));
      marks.visual('messageFlow', e.key, '', '');
      if (e.name) marks.text('label', e.key, '', e.name);
    } else if (e.type === 'dataInputAssociation') marks.visual('dataObject', e.key, 'association', 'input');
    else if (e.type === 'dataOutputAssociation') marks.visual('dataObject', e.key, 'association', 'output');
    // `association` (text annotation): drawn without direction, so the direction in the edge key is not carried.
    edgeParts.push(edgeGroup(e, path.points, lines, bounds, markers));
    if (file) {
      const m = lay.get(e.key);
      if (m?.has('waypoints')) marks.visual('layout', e.key, 'waypoints', m.get('waypoints') ?? '');
    }
  }

  const ordered = containerParts.sort((a, b) => a.order - b.order || b.area - a.area).map((p) => p.svg);
  return finish(model, scene, [...ordered, ...edgeParts, ...nodeParts], bounds, marks, titleOf(model));
}

function centeredBaselineIn(count: number, centerY: number): number {
  return centeredBaseline(count, centerY);
}

// ===========================================================================
// PNML
// ===========================================================================

export function renderPnml(model: ProcessModel, scene: Scene): Rendered {
  const marks = new Marks(model);
  const bounds = new Bounds();
  const lay = layoutIndex(model);
  const file = scene.source === 'file';
  const nodeParts: string[] = [];
  const edgeParts: string[] = [];
  for (const n of model.nodes) {
    const r = scene.nodes.get(n.id)?.rect;
    if (!r || !isDrawnPetri(n)) continue;
    bounds.rect(r);
    const c = { x: cx(r), y: cy(r) };
    let body: string;
    if (n.type === 'place') {
      body = `<ellipse cx="${num(c.x)}" cy="${num(c.y)}" rx="${num(r.w / 2)}" ry="${num(r.h / 2)}" fill="${PAPER}" stroke="${INK}"${sw(1.5)}/>`;
      const tokens = typeof n.attributes.initialMarking === 'number' ? n.attributes.initialMarking : 0;
      if (tokens > 5) {
        body += `<text class="rb-tokens" text-anchor="middle"><tspan x="${num(c.x)}" y="${num(c.y + 4.5)}">${String(tokens)}</tspan></text>`;
        marks.text('initialMarking', n.id, '', String(tokens));
      } else if (tokens > 0) {
        const d = 7;
        const offsets: Record<number, [number, number][]> = {
          1: [[0, 0]],
          2: [[-d, 0], [d, 0]],
          3: [[0, -d], [-d, d / 1.4], [d, d / 1.4]],
          4: [[-d, -d], [d, -d], [-d, d], [d, d]],
          5: [[-d, -d], [d, -d], [0, 0], [-d, d], [d, d]],
        };
        for (const [dx, dy] of offsets[tokens] ?? []) body += `<circle class="rb-token" cx="${num(c.x + dx)}" cy="${num(c.y + dy)}" r="3.5" fill="${INK}"/>`;
        marks.visual('initialMarking', n.id, '', String(tokens));
      }
      marks.visual('place', n.id, '', '');
    } else {
      const silent = n.attributes.silent === true;
      body = `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="${silent ? INK : PAPER}" stroke="${INK}"${sw(1.5)}/>`;
      marks.visual('transition', n.id, '', '');
      if (silent) marks.visual('silentTransition', n.id, '', '');
    }
    const all = belowLines(n);
    // pnml name.offset (relative to the position of the node): the name is centred there instead of below the shape.
    const off = file ? numbers(lay.get(n.id)?.get('name.offset'), 2) : null;
    const nameLines = all.filter((l) => l.role === 'label');
    const rest = off ? all.filter((l) => l.role === 'final') : all;
    const emit = (lines: typeof all, x: number, first: number): void => {
      if (lines.length === 0) return;
      const spans = lines.map((l, i) => `<tspan x="${num(x)}" y="${num(first + i * LINE)}"${l.role === 'final' ? ' font-style="italic"' : ''}>${esc(l.text)}</tspan>`).join('');
      body += `<text class="rb-label" text-anchor="middle"${HALO}>${spans}</text>`;
      const wd = Math.max(...lines.map((l) => textWidth(l.text, FONT)));
      bounds.add(x - wd / 2, first - 10);
      bounds.add(x + wd / 2, first + lines.length * LINE);
    };
    if (off) emit(nameLines, c.x + (off[0] ?? 0), centeredBaseline(nameLines.length, c.y + (off[1] ?? 0)));
    emit(rest, c.x, r.y + r.h + 14);
    if (n.name !== undefined && n.name !== '') marks.text('label', n.id, '', n.name);
    const finals = Array.isArray(n.attributes.finalMarkings) ? n.attributes.finalMarkings : [];
    if (finalMarkingLines(n).length > 0) {
      finals.forEach((tokens, i) => {
        if (typeof tokens === 'number' && tokens > 0) marks.text('finalMarking', n.id, finals.length > 1 ? `m${String(i + 1)}` : '', String(tokens));
      });
    }
    nodeParts.push(`<g class="rb-node rb-${n.type}${n.attributes.silent === true ? ' rb-silent' : ''}" data-element="${esc(n.id)}" data-kind="node" data-type="${n.type}">${body}</g>`);
    if (file) {
      const m = lay.get(n.id);
      if (m?.has('position')) marks.visual('layout', n.id, 'position', m.get('position') ?? '');
      if (m?.has('dimension')) marks.visual('layout', n.id, 'dimension', m.get('dimension') ?? '');
    }
  }
  for (const e of model.edges) {
    const path = scene.edges.get(e.key);
    if (!path) continue;
    const lines: string[] = [];
    if (e.name !== undefined && normalizeLabel(e.name) !== '') lines.push(...wrapEdge(normalizeLabel(e.name)));
    const weight = typeof e.attributes.weight === 'number' ? e.attributes.weight : 1;
    if (weight !== 1) lines.push(String(weight));
    marks.visual('arc', e.key, '', '');
    if (e.name) marks.text('label', e.key, '', e.name);
    if (weight !== 1) marks.text('arcWeight', e.key, '', String(weight));
    edgeParts.push(edgeGroup(e, path.points, lines, bounds));
    if (file) {
      const m = lay.get(e.key);
      if (m?.has('waypoints')) marks.visual('layout', e.key, 'waypoints', m.get('waypoints') ?? '');
    }
  }
  return finish(model, scene, [...edgeParts, ...nodeParts], bounds, marks, titleOf(model));
}

// ===========================================================================

function titleOf(model: ProcessModel): string {
  const root = model.nodes.find((n) => n.name !== undefined && n.name !== '' && (n.type === 'collaboration' || n.type === 'process' || n.type === 'net'));
  return root?.name !== undefined ? normalizeLabel(root.name) : model.formalism === 'bpmn' ? 'BPMN process model' : 'Petri net';
}

function finish(model: ProcessModel, scene: Scene, parts: string[], bounds: Bounds, marks: Marks, title: string): Rendered {
  if (!Number.isFinite(bounds.minX)) {
    bounds.add(0, 0);
    bounds.add(60, 40);
  }
  const x = Math.floor(bounds.minX - MARGIN);
  const y = Math.floor(bounds.minY - MARGIN);
  const w = Math.ceil(bounds.maxX + MARGIN) - x;
  const h = Math.ceil(bounds.maxY + MARGIN) - y;
  const comment = scene.source === 'auto' && scene.fallback !== '' ? `<!-- layout: automatic, because the file layout is not usable (${esc(scene.fallback.replaceAll('--', '- -'))}) -->\n` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}" viewBox="${String(x)} ${String(y)} ${String(w)} ${String(h)}" role="img" font-family="sans-serif" font-size="${String(FONT)}" data-formalism="${model.formalism}" data-layout-source="${scene.source}">\n` +
    comment +
    `<title>${esc(title)}</title>\n${DEFS}\n<rect class="rb-bg" x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" fill="${PAPER}"/>\n` +
    parts.join('\n') +
    '\n</svg>\n';
  return { svg, width: w, height: h, encoding: marks.map };
}

export type { BpmnIndex, Fact };
