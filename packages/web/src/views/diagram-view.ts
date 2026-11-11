import { el } from '../dom.ts';
import { DIAGRAM_SOURCE_COLOURS } from '../tokens.ts';

/**
 * The diagram view (UI-07): the SVG of the core shown inline, with zoom (wheel, pinch, + and -), pan (drag, arrow keys) and "fit"
 * (key 0, double click, and automatically when the diagram is new or the window changes while the person has not zoomed). The SVG is
 * parsed with DOMParser and imported, never assigned as markup. Colours of the core's grey scale are mapped to the tokens by class.
 */

const MIN_SCALE = 0.05;
/** Below this scale a fitted diagram is not readable; a width-limited fit then keeps at least MIN_FIT and the person pans (H72). */
const READABLE_SCALE = 0.5;
const MIN_FIT = 0.4;
const FIT_PAD = 16;
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

export interface DiagramHandlers {
  /** The person activated an element (click, tap, Enter or Space). */
  onSelect(key: string): void;
}

const SVG_ELEMENT = 'g[data-element]';

export class DiagramView {
  readonly element: HTMLElement;
  private readonly stage: HTMLElement;
  private groups: SVGGElement[] = [];
  private selected: string | null = null;
  private tabStop = 0;
  private down: { key: string | null; x: number; y: number } | null = null;
  private labeller: ((key: string) => string) | null = null;
  handlers: DiagramHandlers = { onSelect: () => undefined };
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
    this.element.addEventListener('focusin', (e) => {
      const g = e.target instanceof Element ? e.target.closest(SVG_ELEMENT) : null;
      const i = g ? this.groups.indexOf(g as SVGGElement) : -1;
      if (i >= 0) this.setTabStop(i);
    });
    new ResizeObserver(() => {
      if (this.fitted && this.width > 0) this.fit();
    }).observe(this.element);
  }

  /** Shows a new SVG; nothing changes when the markup is the one already shown (the language was switched, for example). */
  setSvg(svg: string, labelOf: (key: string) => string): void {
    this.labeller = labelOf;
    if (svg === this.svgText) {
      this.decorate();
      return;
    }
    this.svgText = svg;
    const parsed = parseSvg(svg);
    this.stage.replaceChildren();
    if (!parsed) {
      this.width = this.height = 0;
      return;
    }
    this.width = Number(parsed.getAttribute('width')) || 0;
    this.height = Number(parsed.getAttribute('height')) || 0;
    // The elements inside are buttons, so the drawing itself must not be hidden from assistive technology; the root only groups them.
    parsed.setAttribute('role', 'none');
    parsed.setAttribute('focusable', 'false');
    this.stage.append(parsed);
    this.groups = [...parsed.querySelectorAll<SVGGElement>(SVG_ELEMENT)];
    this.tabStop = 0;
    this.decorate();
    this.applySelection();
    this.fitted = true;
    this.fit();
  }

  /**
   * Every drawn element is a focusable button with a label (FA-61, NF-04). One element is a tab stop at a time (roving tabindex): a
   * diagram of 500 nodes would otherwise take 500 presses of Tab to get past. Arrow keys move between the elements.
   */
  private decorate(): void {
    this.groups.forEach((g, i) => {
      const key = g.getAttribute('data-element') ?? '';
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', i === this.tabStop ? '0' : '-1');
      g.setAttribute('aria-label', this.labeller?.(key) ?? key);
      g.setAttribute('aria-pressed', String(key === this.selected));
    });
  }

  private setTabStop(i: number): void {
    if (i === this.tabStop || !this.groups[i]) return;
    this.groups[this.tabStop]?.setAttribute('tabindex', '-1');
    this.tabStop = i;
    this.groups[i]?.setAttribute('tabindex', '0');
  }

  private groupKey(target: EventTarget | null): string | null {
    const g = target instanceof Element ? target.closest(SVG_ELEMENT) : null;
    return g?.getAttribute('data-element') ?? null;
  }

  /** Marks the element with `key` as selected (accent stroke) and clears the mark of the previous one. Returns whether it is drawn. */
  setSelection(key: string | null, reveal = false): boolean {
    this.selected = key;
    const found = this.applySelection();
    if (found && reveal) this.reveal(found);
    return found !== null;
  }

  private applySelection(): SVGGElement | null {
    let found: SVGGElement | null = null;
    for (const g of this.groups) {
      const on = this.selected !== null && g.getAttribute('data-element') === this.selected;
      g.classList.toggle('is-selected', on);
      g.setAttribute('aria-pressed', String(on));
      if (on) found = g;
    }
    return found;
  }

  /** Pans so that the element is inside the view; the scale is left alone. */
  private reveal(g: SVGGElement): void {
    const box = this.element.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    if (box.width === 0) return;
    const m = 24;
    let dx = 0;
    let dy = 0;
    if (r.left < box.left + m) dx = box.left + m - r.left;
    else if (r.right > box.right - m) dx = box.right - m - r.right;
    if (r.top < box.top + m) dy = box.top + m - r.top;
    else if (r.bottom > box.bottom - m) dy = box.bottom - m - r.bottom;
    if (dx !== 0 || dy !== 0) {
      this.x += dx;
      this.y += dy;
      this.fitted = false;
      this.apply();
    }
  }

  clear(): void {
    this.svgText = '';
    this.stage.replaceChildren();
    this.groups = [];
    this.width = this.height = 0;
  }

  get scale(): number {
    return this.k;
  }

  /**
   * Fits the drawing (H72). Normally the whole drawing is scaled into the view and centred. A wide drawing in a narrow, tall view
   * (a phone) would end up tiny in the middle of an empty area; there the fit follows the width instead, never below MIN_FIT, is
   * aligned to the top left and the person pans to the rest.
   */
  fit(): void {
    const box = this.element.getBoundingClientRect();
    if (this.width === 0 || box.width === 0 || box.height === 0) return;
    const kw = (box.width - 2 * FIT_PAD) / this.width;
    const kh = (box.height - 2 * FIT_PAD) / this.height;
    const whole = Math.min(1, kw, kh);
    if (whole >= READABLE_SCALE || kh <= kw) {
      this.k = Math.max(MIN_SCALE, whole);
      this.x = (box.width - this.width * this.k) / 2;
      this.y = (box.height - this.height * this.k) / 2;
    } else {
      this.k = Math.min(1, Math.max(kw, MIN_FIT));
      const w = this.width * this.k;
      this.x = w <= box.width - 2 * FIT_PAD ? (box.width - w) / 2 : FIT_PAD;
      this.y = FIT_PAD;
    }
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
    this.down = this.pointers.size === 0 ? { key: this.groupKey(e.target), x: e.clientX, y: e.clientY } : null;
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
    // A press and release without moving on an element selects it. The pointer is captured, so the click would not name the element.
    const down = this.down;
    this.down = null;
    if (e.type === 'pointerup' && down?.key && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && this.pointers.size === 1) this.handlers.onSelect(down.key);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) delete this.element.dataset['dragging'];
  }

  /** Keys on an element: Enter and Space select it, the arrows move to the neighbouring element. Returns whether the key was used. */
  private onGroupKey(e: KeyboardEvent, i: number): boolean {
    if (e.key === 'Enter' || e.key === ' ') {
      const key = this.groups[i]?.getAttribute('data-element');
      if (key) this.handlers.onSelect(key);
      return true;
    }
    const move = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? this.groups.length - 1 : null;
    if (move === null) return false;
    const next = this.groups[Math.min(this.groups.length - 1, Math.max(0, move))];
    next?.focus({ preventScroll: true });
    if (next) this.reveal(next);
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || this.width === 0) return;
    const g = e.target instanceof Element ? e.target.closest(SVG_ELEMENT) : null;
    const gi = g ? this.groups.indexOf(g as SVGGElement) : -1;
    if (gi >= 0 && this.onGroupKey(e, gi)) {
      e.preventDefault();
      return;
    }
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
