/** Small helpers for writing SVG text deterministically: fixed number format, XML escaping. */

/** Number as written into the SVG: at most one decimal place, `.` as separator, no exponent, no negative zero (R-5). */
export function num(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (Object.is(r, -0) || r === 0) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Escapes text for element content and double-quoted attributes. Characters not allowed in XML 1.0 are replaced by U+FFFD. */
export function esc(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const ok = c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000;
    if (!ok) out += '�';
    else if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else out += ch;
  }
  return out;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const cx = (r: Rect): number => r.x + r.w / 2;
export const cy = (r: Rect): number => r.y + r.h / 2;

/** `points` as the `points`/`d` coordinate list: "x,y x,y". */
export function pts(points: readonly Pt[]): string {
  return points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
}

export function pathOf(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ');
}
