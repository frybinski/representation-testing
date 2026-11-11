import type { Bundle, GeneratorRegistry, InventoryCell, FactCategory } from '@repr-werkbank/core';
import { icon, type IconName } from './icons.ts';

type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children);
  return node;
}

const COUNT = new Intl.NumberFormat('en-US');

/** Interface labels of the fact categories (FA-50). The category ids themselves come from the core. */
const CATEGORY_LABEL: Record<FactCategory, string> = {
  node: 'Node',
  nodeType: 'Node type',
  label: 'Label',
  identifier: 'Identifier',
  sequenceFlow: 'Sequence flow',
  sequenceFlowName: 'Sequence flow name',
  condition: 'Condition',
  defaultFlow: 'Default flow',
  eventType: 'Event type',
  poolLane: 'Pool and lane',
  messageFlow: 'Message flow',
  dataObject: 'Data object',
  annotation: 'Annotation',
  layout: 'Layout',
  place: 'Place',
  transition: 'Transition',
  arc: 'Arc',
  arcWeight: 'Arc weight',
  initialMarking: 'Initial marking',
  finalMarking: 'Final marking',
  silentTransition: 'Silent transition',
};

const STATUS: Record<InventoryCell['status'], { word: string; icon: IconName | null }> = {
  complete: { word: 'complete', icon: 'complete' },
  partial: { word: 'partial', icon: 'partial' },
  none: { word: 'none', icon: 'none' },
  notInModel: { word: 'not in this model', icon: null },
};

export interface AppOptions {
  root: HTMLElement;
  bundle: Bundle;
  registry: GeneratorRegistry;
  modelName: string;
  initialViews: [string, string];
}

type LowerTab = 'overview' | 'inventory' | 'structure' | 'export';
const LOWER_TABS: { id: LowerTab; label: string; wired: boolean }[] = [
  { id: 'overview', label: 'Overview', wired: false },
  { id: 'inventory', label: 'Inventory', wired: true },
  { id: 'structure', label: 'Structure report', wired: false },
  { id: 'export', label: 'Export', wired: false },
];

const NOT_WIRED = 'Not part of the design draft';

function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function effectiveScheme(): 'light' | 'dark' {
  const chosen = document.documentElement.dataset['scheme'];
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return systemIsDark() ? 'dark' : 'light';
}

/** Arrow keys move the focus between the buttons of a tab list; Home and End go to the first and the last. */
function arrowKeys(list: HTMLElement): void {
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    tabs[(next + tabs.length) % tabs.length]?.focus();
  });
}

function iconButton(name: IconName, label: string): HTMLButtonElement {
  // Label for assistive technology and tooltip (UI-09). The draft does not wire the action.
  const b = el('button', { type: 'button', class: 'icon-button', 'aria-label': label, title: `${label} (${NOT_WIRED.toLowerCase()})` });
  b.append(icon(name));
  return b;
}

function textButton(label: string, extra: Record<string, string> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'text-button', 'aria-disabled': 'true', title: NOT_WIRED, ...extra }, label);
}

export function mountApp(opts: AppOptions): void {
  const { root, bundle, registry } = opts;
  const nameOf = (id: string): string => registry.get(id).name.en;
  const figuresOf = (id: string) => bundle.figures.rows.find((r) => r.id === id);
  const tokenizerInfo = `Token count: ${bundle.figures.tokenizer.name}, ${bundle.figures.tokenizer.implementation}`;

  // ---- header -------------------------------------------------------------------------------------------------------------------
  const schemeButton = el('button', { type: 'button', class: 'icon-button', title: 'Colour scheme' });
  schemeButton.append(icon('scheme'));
  const updateSchemeLabel = (): void => {
    const next = effectiveScheme() === 'dark' ? 'light' : 'dark';
    schemeButton.setAttribute('aria-label', `Colour scheme: switch to ${next}`);
    schemeButton.title = `Colour scheme: switch to ${next}`;
  };
  schemeButton.addEventListener('click', () => {
    document.documentElement.dataset['scheme'] = effectiveScheme() === 'dark' ? 'light' : 'dark';
    updateSchemeLabel();
  });
  updateSchemeLabel();

  const language = el(
    'span',
    { class: 'segmented', role: 'group', 'aria-label': 'Interface language', title: NOT_WIRED },
    el('button', { type: 'button', class: 'text-button', 'aria-pressed': 'true', 'aria-disabled': 'true' }, 'EN'),
    el('span', { class: 'sep', 'aria-hidden': 'true' }, '|'),
    el('button', { type: 'button', class: 'text-button', 'aria-pressed': 'false', 'aria-disabled': 'true' }, 'DE'),
  );

  const header = el(
    'header',
    { class: 'top' },
    el('span', { class: 'brand' }, 'repr-werkbank'),
    el('p', { class: 'model' }, 'Model: ', el('span', { class: 'model-name' }, opts.modelName)),
    el('nav', { class: 'actions', 'aria-label': 'Main' }, textButton('Load'), textButton('Examples'), language, schemeButton, textButton('About'), textButton('Formats')),
  );

  // ---- views --------------------------------------------------------------------------------------------------------------------
  interface View {
    section: HTMLElement;
    select: HTMLSelectElement;
    scroll: HTMLElement;
    figures: HTMLElement;
    tab: HTMLButtonElement;
  }

  const makeView = (key: 'a' | 'b', initial: string): View => {
    const label = key === 'a' ? 'View A' : 'View B';
    const select = el('select', { class: 'select', id: `rep-${key}`, 'aria-label': `Representation, ${label}` });
    // The draft shows text only; the diagram view comes in the next stage (bundle format 2 has the image representation with kind 'image').
    for (const r of bundle.representations.filter((x) => x.kind === 'text')) select.append(el('option', { value: r.id }, nameOf(r.id)));
    select.value = initial;

    const bar = el(
      'div',
      { class: 'bar' },
      el('span', { class: 'select-wrap' }, select, icon('chevron')),
      el('div', { class: 'bar-buttons' }, iconButton('options', 'Options'), iconButton('copy', 'Copy to clipboard'), iconButton('save', 'Save as file')),
    );
    const scroll = el('div', { class: 'text-scroll', tabindex: '0', role: 'region', 'aria-label': `Text of ${label}` });
    const figures = el('p', { class: 'figures', title: tokenizerInfo });
    const section = el('section', { class: 'view', id: `view-${key}`, 'aria-label': label }, bar, scroll, figures);
    const tab = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${key}`, 'aria-controls': `view-${key}` });
    const view: View = { section, select, scroll, figures, tab };

    const show = (): void => {
      const id = select.value;
      const rep = bundle.representations.find((r) => r.id === id);
      const text = rep?.text ?? '';
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      const gutter = el('pre', { class: 'gutter', 'aria-hidden': 'true' }, lines.map((_, i) => String(i + 1)).join('\n'));
      const code = el('pre', { class: 'code' }, text);
      scroll.replaceChildren(gutter, code);
      scroll.scrollTo(0, 0);
      const f = figuresOf(id);
      figures.textContent = f?.kind === 'text'
        ? `${COUNT.format(f.characters)} characters · ${COUNT.format(f.lines)} lines · ${COUNT.format(f.tokens)} tokens`
        : '';
      tab.textContent = nameOf(id);
    };
    select.addEventListener('change', show);
    show();
    return view;
  };

  const viewA = makeView('a', opts.initialViews[0]);
  const viewB = makeView('b', opts.initialViews[1]);

  // On a narrow screen the two views are tabs on top of each other (UI-09); on a wide screen the tab strip is hidden by CSS.
  const narrowTabs = el('div', { class: 'narrow-tabs', role: 'tablist', 'aria-label': 'Views' }, viewA.tab, viewB.tab);
  arrowKeys(narrowTabs);
  const selectNarrow = (key: 'a' | 'b'): void => {
    for (const [k, v] of [['a', viewA], ['b', viewB]] as const) {
      const active = k === key;
      v.tab.setAttribute('aria-selected', String(active));
      v.section.dataset['narrowActive'] = String(active);
    }
  };
  viewA.tab.addEventListener('click', () => selectNarrow('a'));
  viewB.tab.addEventListener('click', () => selectNarrow('b'));
  selectNarrow('a');

  const views = el('main', { class: 'views' }, narrowTabs, viewA.section, viewB.section);

  // ---- lower area ---------------------------------------------------------------------------------------------------------------
  const panel = el('div', { class: 'lower-panel', role: 'tabpanel', id: 'lower-panel', 'aria-labelledby': 'lower-tab-inventory', hidden: true });
  const lowerTabs = el('div', { class: 'lower-tabs', role: 'tablist', 'aria-label': 'Analysis' });
  const lower = el('section', { class: 'lower', 'aria-label': 'Analysis', 'data-open': 'false' }, lowerTabs, panel);
  const tabButtons = new Map<LowerTab, HTMLButtonElement>();
  let open: LowerTab | null = null;

  const setOpen = (next: LowerTab | null): void => {
    open = next;
    for (const [id, b] of tabButtons) {
      b.setAttribute('aria-selected', String(id === open));
      b.setAttribute('aria-expanded', String(id === open));
    }
    panel.hidden = open === null;
    lower.dataset['open'] = String(open !== null);
    if (open === 'inventory') panel.replaceChildren(inventoryPanel());
  };

  for (const t of LOWER_TABS) {
    const b = el('button', { type: 'button', role: 'tab', class: 'tab', id: `lower-tab-${t.id}`, 'aria-selected': 'false', 'aria-expanded': 'false', 'aria-controls': 'lower-panel' }, t.label);
    if (!t.wired) {
      b.setAttribute('aria-disabled', 'true');
      b.title = NOT_WIRED;
    }
    b.addEventListener('click', () => {
      if (t.wired) setOpen(open === t.id ? null : t.id);
    });
    tabButtons.set(t.id, b);
    lowerTabs.append(b);
  }
  arrowKeys(lowerTabs);

  function inventoryPanel(): HTMLElement {
    const inv = bundle.inventory;
    const head = el('tr', {}, el('th', { scope: 'col', class: 'cat-head' }, 'Category'));
    for (const col of inv.columns) head.append(el('th', { scope: 'col' }, nameOf(col.id)));
    const body = el('tbody');
    for (const cat of inv.categories) {
      const absent = (inv.totals[cat] ?? 0) === 0;
      const th = el('th', { scope: 'row', class: 'cat' }, CATEGORY_LABEL[cat]);
      if (absent) th.append(el('span', { class: 'absent' }, 'not in this model'));
      const tr = el('tr', { class: absent ? 'is-absent' : '' }, th);
      for (const col of inv.columns) {
        const cell = col.cells.find((c) => c.category === cat);
        if (!cell) {
          tr.append(el('td', {}, ''));
          continue;
        }
        const st = STATUS[cell.status];
        const td = el('td', { class: `cell cell-${cell.status}` });
        if (st.icon) {
          td.append(el('span', { class: 'pill' }, icon(st.icon), `${cell.carried} of ${cell.total}`, el('span', { class: 'sr-only' }, ` ${st.word}`)));
        } else {
          td.append(el('span', { 'aria-hidden': 'true' }, '–'), el('span', { class: 'sr-only' }, ` ${st.word}`));
        }
        tr.append(td);
      }
      body.append(tr);
    }
    const table = el('table', { class: 'matrix' }, el('caption', { class: 'sr-only' }, 'Facts of the model that each representation carries, as carried of total, with status'), el('thead', {}, head), body);
    const legend = el('ul', { class: 'legend' });
    for (const s of ['complete', 'partial', 'none'] as const) {
      legend.append(el('li', { class: `cell-${s}` }, icon(STATUS[s].icon as IconName), STATUS[s].word));
    }
    legend.append(el('li', { class: 'cell-notInModel' }, el('span', { 'aria-hidden': 'true' }, '–'), 'category not in this model'));
    const sizes = el('p', { class: 'inventory-note' }, `Facts in the model: ${Object.values(inv.totals).reduce((a, b) => a + b, 0)}`);
    const scroller = el('div', { class: 'matrix-scroll', tabindex: '0', role: 'region', 'aria-label': 'Inventory matrix' }, table);
    return el('div', { class: 'inventory' }, scroller, el('div', { class: 'inventory-foot' }, legend, sizes));
  }

  root.replaceChildren(el('div', { class: 'shell' }, header, views, lower));
}
