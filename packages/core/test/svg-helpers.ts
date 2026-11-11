import { JSDOM } from 'jsdom';

export function parseSvg(svg: string): Document {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  return dom.window.document;
}

/** Texts of a `<text>` element: its tspans joined by one space, or its own text. */
export function textOf(el: Element): string {
  const spans = [...el.querySelectorAll('tspan')];
  return (spans.length > 0 ? spans.map((s) => s.textContent ?? '') : [el.textContent ?? '']).join(' ');
}
