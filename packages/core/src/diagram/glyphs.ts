import { num } from './svg.js';

/** Grey scale of the diagram (NF-06). The page may override every colour by CSS classes; these values make an exported file self-contained. */
export const INK = '#333333';
export const PAPER = '#ffffff';
export const BAND = '#f6f6f6';

const t = (x: number, y: number): string => `translate(${num(x)} ${num(y)})`;
const poly = (points: string, filled: boolean, extra = ''): string =>
  `<polygon points="${points}" fill="${filled ? INK : PAPER}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"${extra}/>`;

/** Event definitions that have a marker. The names are those of the model (`eventDefinitions`). */
export const EVENT_GLYPHS = new Set(['message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'link', 'compensate', 'cancel', 'terminate']);

/**
 * Marker of an event definition, centred at (x, y), about 18 px wide. `filled` is the throwing variant (end events, throwing
 * intermediate events); the catching variant is an outline (BPMN 2.0 specification, event notation).
 */
export function eventGlyph(def: string, x: number, y: number, filled: boolean): string {
  const g = (body: string): string => `<g transform="${t(x, y)}" class="rb-glyph rb-glyph-${def}">${body}</g>`;
  switch (def) {
    case 'message': {
      const flap = `<polyline points="-9,-6 0,1 9,-6" fill="none" stroke="${filled ? PAPER : INK}" stroke-width="1" stroke-linejoin="round"/>`;
      return g(`<rect x="-9" y="-6" width="18" height="12" fill="${filled ? INK : PAPER}" stroke="${INK}" stroke-width="1"/>${flap}`);
    }
    case 'timer':
      return g(
        `<circle r="9" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><path d="M0 -9V-7M0 9V7M-9 0H-7M9 0H7" stroke="${INK}" stroke-width="1"/><polyline points="0,-6 0,0 4,2" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    case 'error':
      return g(poly('-8,8 -4,-4 1,2 8,-8 4,4 -1,-2', filled));
    case 'signal':
      return g(poly('0,-9 9,7 -9,7', filled));
    case 'escalation':
      return g(poly('0,-9 7,8 0,3 -7,8', filled));
    case 'conditional': {
      const lines = [-4, 0, 4].map((dy) => `<path d="M-4 ${String(dy)}H4" stroke="${filled ? PAPER : INK}" stroke-width="1"/>`).join('');
      return g(`<rect x="-6" y="-8" width="12" height="16" fill="${filled ? INK : PAPER}" stroke="${INK}" stroke-width="1"/>${lines}`);
    }
    case 'link':
      return g(poly('-9,-3 0,-3 0,-8 9,0 0,8 0,3 -9,3', filled));
    case 'compensate':
      return g(`${poly('-9,0 -1,-6 -1,6', filled)}${poly('-1,0 7,-6 7,6', filled)}`);
    case 'cancel':
      return g(`<path d="M-6 -6L6 6M-6 6L6 -6" stroke="${INK}" stroke-width="3" fill="none"/>`);
    case 'terminate':
      return g(`<circle r="9" fill="${INK}" stroke="${INK}" stroke-width="1"/>`);
    default:
      return '';
  }
}

/** The marker of an event with several definitions (a pentagon, as in the BPMN specification). */
export function multipleGlyph(x: number, y: number, filled: boolean): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (-90 + 72 * i) * (Math.PI / 180);
    pts.push(`${num(9 * Math.cos(a))},${num(9 * Math.sin(a))}`);
  }
  return `<g transform="${t(x, y)}" class="rb-glyph rb-glyph-multiple">${poly(pts.join(' '), filled)}</g>`;
}

/** Marker in the top left corner of a task, `x`, `y` is its top left corner, 14 px square. */
export function taskGlyph(type: string, x: number, y: number): string | null {
  const g = (body: string): string => `<g transform="${t(x, y)}" class="rb-glyph rb-glyph-${type}" fill="none" stroke="${INK}" stroke-width="1">${body}</g>`;
  switch (type) {
    case 'userTask':
      return g(`<circle cx="7" cy="4" r="3"/><path d="M1 13Q1 8 7 8Q13 8 13 13Z"/>`);
    case 'serviceTask': {
      const ticks = Array.from({ length: 8 }, (_, i) => {
        const a = i * 45 * (Math.PI / 180);
        return `M${num(7 + 4 * Math.cos(a))} ${num(7 + 4 * Math.sin(a))}L${num(7 + 6.5 * Math.cos(a))} ${num(7 + 6.5 * Math.sin(a))}`;
      }).join('');
      return g(`<circle cx="7" cy="7" r="3.5"/><path d="${ticks}" stroke-width="1.6"/>`);
    }
    case 'scriptTask':
      return g(`<path d="M3 1H12V13H5Q3 13 3 11Z"/><path d="M5 4.5H10M5 7.5H10M5 10.5H9"/>`);
    case 'sendTask':
      return g(`<rect x="0.5" y="2.5" width="13" height="9" fill="${INK}"/><polyline points="0.5,2.5 7,7.5 13.5,2.5" stroke="${PAPER}"/>`);
    case 'receiveTask':
      return g(`<rect x="0.5" y="2.5" width="13" height="9"/><polyline points="0.5,2.5 7,7.5 13.5,2.5"/>`);
    case 'manualTask':
      return g(`<path d="M2 13V7L4 6V3.5L6 3V6.5H8V4L10 4.5V8L12 7.5V13Z"/>`);
    case 'businessRuleTask':
      return g(`<rect x="0.5" y="1.5" width="13" height="11"/><path d="M0.5 5.5H13.5M0.5 9H13.5M5 1.5V12.5"/><rect x="0.5" y="1.5" width="13" height="4" fill="${BAND}"/>`);
    default:
      return null;
  }
}

/** Marker inside a gateway diamond centred at (x, y). */
export function gatewayGlyph(type: string, x: number, y: number): string {
  const g = (body: string): string => `<g transform="${t(x, y)}" class="rb-glyph rb-glyph-${type}" fill="none" stroke="${INK}">${body}</g>`;
  switch (type) {
    case 'exclusiveGateway':
      return g(`<path d="M-6 -6L6 6M-6 6L6 -6" stroke-width="3"/>`);
    case 'parallelGateway':
      return g(`<path d="M-8 0H8M0 -8V8" stroke-width="3"/>`);
    case 'inclusiveGateway':
      return g(`<circle r="9" stroke-width="2.5"/>`);
    case 'eventBasedGateway': {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (-90 + 72 * i) * (Math.PI / 180);
        pts.push(`${num(6 * Math.cos(a))},${num(6 * Math.sin(a))}`);
      }
      return g(`<circle r="10" stroke-width="1"/><circle r="8" stroke-width="1"/><polygon points="${pts.join(' ')}" stroke-width="1"/>`);
    }
    default:
      return '';
  }
}
