import { el } from '../dom.ts';
import { DIAGRAM_SOURCE_COLOURS } from '../tokens.ts';

/**
 * The diagram view (UI-07): the SVG of the core shown inline, with zoom (wheel, pinch, + and -), pan (drag, arrow keys) and "fit"
 * (key 0, double click, and automatically when the diagram is new or the window changes while the person has not zoomed). The SVG is
 * parsed with DOMParser and imported, never assigned as markup. Colours of the core's grey scale are mapped to the tokens by class.
 */

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
const PAN_STEP = 48;

/** Parses SVG text from the core. Returns null when it is not well-formed XML (the page then shows nothing rather than markup). */
export function parseSvg(svg: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const root = doc.documentElement;
  if (root.localName !== 'svg') return null;
  const imported = document.importNode(root, true) as unknown as SVGSVGElement;
  for (const node of imported.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke'] as const) {
      const value = node.getAttribute(attr);
      const role = value === null ? undefined : DIAGRAM_SOURCE_COLOURS[value.toLowerCase()];
      if (role) node.classList.add(`${attr === 'fill' ? 'f' : 's'}-${role}`);
    }
  }
  return imported;
}

export class DiagramView {
  readonly element: HTMLElement;
  private readonly stage: HTMLElement;
  private svgText = '';
  private width = 0;
  private height = 0;
  private x = 0;
  private y = 0;
  private k = 1;
  /** True until the person zooms or pans: then a new size of the window refits. */
  private fitted = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; k: number } | null = null;

  constructor() {
    this.stage = el('div', { class: 'diagram-stage' });
    this.element = el('div', { class: 'diagram', tabindex: '0', role: 'group' }, this.stage);
    this.element.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.element.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.element.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.element.addEventListener('pointerup', (e) => this.onPointerEnd(e));
    this.element.addEventListener('pointercancel', (e) => this.onPointerEnd(e));
    this.element.addEventListener('dblclick', () => this.fit());
    this.element.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => {
      if (this.fitted && this.width > 0) this.fit();
    }).observe(this.element);
  }

  /** Shows a new SVG; nothing changes when the markup is the one already shown (the language was switched, for example). */
  setSvg(svg: string): void {
    if (svg === this.svgText) return;
    this.svgText = svg;
    const parsed = parseSvg(svg);
    this.stage.replaceChildren();
    if (!parsed) {
      this.width = this.height = 0;
      return;
    }
    this.width = Number(parsed.getAttribute('width')) || 0;
    this.height = Number(parsed.getAttribute('height')) || 0;
    parsed.removeAttribute('role');
    parsed.setAttribute('aria-hidden', 'true');
    parsed.setAttribute('focusable', 'false');
    this.stage.append(parsed);
    this.fitted = true;
    this.fit();
  }

  clear(): void {
    this.svgText = '';
    this.stage.replaceChildren();
    this.width = this.height = 0;
  }

  get scale(): number {
    return this.k;
  }

  fit(): void {
    const box = this.element.getBoundingClientRect();
    if (this.width === 0 || box.width === 0 || box.height === 0) return;
    const pad = 16;
    this.k = Math.min(1, (box.width - 2 * pad) / this.width, (box.height - 2 * pad) / this.height);
    this.k = Math.max(MIN_SCALE, this.k);
    this.x = (box.width - this.width * this.k) / 2;
    this.y = (box.height - this.height * this.k) / 2;
    this.fitted = true;
    this.apply();
  }

  private apply(): void {
    this.stage.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`;
  }

  /** Zooms by `factor` around the point (px, py) of the view. */
  private zoomAt(factor: number, px: number, py: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.k * factor));
    const ratio = next / this.k;
    this.x = px - (px - this.x) * ratio;
    this.y = py - (py - this.y) * ratio;
    this.k = next;
    this.fitted = false;
    this.apply();
  }

  private centre(): { x: number; y: number } {
    const box = this.element.getBoundingClientRect();
    return { x: box.width / 2, y: box.height / 2 };
  }

  private onWheel(e: WheelEvent): void {
    if (this.width === 0) return;
    e.preventDefault();
    const box = this.element.getBoundingClientRect();
    // Pixels per notch differ between devices; an exponential step keeps a trackpad smooth and a mouse wheel usable.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    this.zoomAt(Math.exp((-e.deltaY * unit) / (e.ctrlKey ? 100 : 300)), e.clientX - box.left, e.clientY - box.top);
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.element.setPointerCapture(e.pointerId);
    this.element.dataset['dragging'] = 'true';
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, now);
    if (this.pointers.size === 1) {
      this.x += now.x - prev.x;
      this.y += now.y - prev.y;
      this.fitted = false;
      this.apply();
    } else if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const box = this.element.getBoundingClientRect();
      if (this.pinchStart.distance > 0) this.zoomAt((this.pinchStart.k * (distance / this.pinchStart.distance)) / this.k, (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) delete this.element.dataset['dragging'];
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || this.width === 0) return;
    const c = this.centre();
    const pan = (dx: number, dy: number): void => {
      this.x += dx;
      this.y += dy;
      this.fitted = false;
      this.apply();
    };
    switch (e.key) {
      case '+':
      case '=':
        this.zoomAt(ZOOM_STEP, c.x, c.y);
        break;
      case '-':
      case '_':
        this.zoomAt(1 / ZOOM_STEP, c.x, c.y);
        break;
      case '0':
        this.fit();
        break;
      case 'ArrowLeft':
        pan(PAN_STEP, 0);
        break;
      case 'ArrowRight':
        pan(-PAN_STEP, 0);
        break;
      case 'ArrowUp':
        pan(0, PAN_STEP);
        break;
      case 'ArrowDown':
        pan(0, -PAN_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
