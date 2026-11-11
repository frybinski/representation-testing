import { cx, cy, type Pt, type Rect } from './svg.js';

export type ShapeKind = 'rect' | 'ellipse' | 'diamond';

/**
 * Point where the ray from the centre of `rect` towards `toward` leaves the shape inscribed in `rect`
 * (rectangle, ellipse or diamond). When `toward` is the centre itself the centre is returned.
 */
export function boundaryPoint(kind: ShapeKind, rect: Rect, toward: Pt): Pt {
  const c = { x: cx(rect), y: cy(rect) };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  let t: number;
  if (kind === 'rect') t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  else if (kind === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export function contains(r: Rect, p: Pt, margin = 0): boolean {
  return p.x >= r.x - margin && p.x <= r.x + r.w + margin && p.y >= r.y - margin && p.y <= r.y + r.h + margin;
}

/** Whether the segment a-b passes through the interior of `r` (Liang-Barsky; touching the border does not count). */
export function segmentCrosses(a: Pt, b: Pt, r: Rect): boolean {
  const x0 = r.x + 0.5;
  const x1 = r.x + r.w - 0.5;
  const y0 = r.y + 0.5;
  const y1 = r.y + r.h - 0.5;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t0 < t1;
}

export function pathCrosses(points: readonly Pt[], r: Rect): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b && segmentCrosses(a, b, r)) return true;
  }
  return false;
}

/** Removes repeated points and the middle point of three collinear axis-parallel points. */
export function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
    while (out.length >= 3) {
      const c = out[out.length - 1];
      const b = out[out.length - 2];
      const a = out[out.length - 3];
      if (!a || !b || !c) break;
      const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
      const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
      if (sameX || sameY) {
        out.splice(out.length - 2, 1);
      } else break;
    }
  }
  return out;
}

export function translate(points: readonly Pt[], dx: number, dy: number): Pt[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function pathLength(points: readonly Pt[]): number {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b) n += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return n;
}

/** Point at half the length of the path, with the direction (unit vector) of the segment it lies on. */
export function pathMiddle(points: readonly Pt[]): { at: Pt; dir: Pt } {
  const half = pathLength(points) / 2;
  let run = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + len >= half && len > 0) {
      const t = (half - run) / len;
      return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    }
    run += len;
  }
  const p = points[0] ?? { x: 0, y: 0 };
  return { at: p, dir: { x: 1, y: 0 } };
}
