import { typeName, type Inventory, type InventoryCell } from '@repr-werkbank/core';
import { el } from '../dom.ts';
import { getLang, t, type Key } from '../i18n.ts';
import { icon, type IconName } from '../icons.ts';

const STATUS: Record<InventoryCell['status'], { key: Key | null; icon: IconName | null }> = {
  complete: { key: 'inventory.complete', icon: 'complete' },
  partial: { key: 'inventory.partial', icon: 'partial' },
  none: { key: 'inventory.none', icon: 'none' },
  notInModel: { key: 'inventory.notInModel', icon: null },
};

/** The cell whose missing facts are listed below the matrix (FA-54). */
export interface MissingSelection {
  column: string;
  category: string;
}

export interface InventoryHandlers {
  /** A cell with missing facts was activated; the same cell again closes the list. */
  onCell(sel: MissingSelection): void;
  /** An element in the list of missing facts was activated: the views select it (FA-61). */
  onElement(key: string): void;
}

/**
 * The matrix of FA-51: category by representation, each cell "n of m" with a symbol and the status as text (never colour alone, UI-06).
 * A cell with missing facts is a button (FA-54): it lists the missing facts with their elements below the matrix, not in a dialog.
 */
export function renderInventory(inv: Inventory, columnName: (id: string) => string, open: MissingSelection | null, handlers: InventoryHandlers): HTMLElement {
  const head = el('tr', {}, el('th', { scope: 'col', class: 'cat-head' }, t('inventory.category')));
  for (const col of inv.columns) head.append(el('th', { scope: 'col' }, columnName(col.id)));
  const body = el('tbody');
  for (const cat of inv.categories) {
    const absent = (inv.totals[cat] ?? 0) === 0;
    const th = el('th', { scope: 'row', class: 'cat' }, t(`cat.${cat}`));
    if (absent) th.append(el('span', { class: 'absent' }, t('inventory.notInModel')));
    const tr = el('tr', { class: absent ? 'is-absent' : '' }, th);
    for (const col of inv.columns) {
      const cell = col.cells.find((c) => c.category === cat);
      if (!cell) {
        tr.append(el('td', {}, ''));
        continue;
      }
      const st = STATUS[cell.status];
      const word = st.key ? t(st.key) : '';
      const td = el('td', { class: `cell cell-${cell.status}` });
      if (st.icon) {
        const hasMissing = cell.missing.length > 0;
        const isOpen = open?.column === col.id && open.category === cat;
        const pill = el(hasMissing ? 'button' : 'span', { class: 'pill' }, icon(st.icon), t('inventory.cell', { carried: cell.carried, total: cell.total }), el('span', { class: 'sr-only' }, ` ${word}`));
        if (cell.asText !== undefined && cell.visual !== undefined && cell.carried > 0) {
          const split = t('inventory.split', { text: cell.asText, visual: cell.visual });
          pill.title = split;
          pill.append(el('span', { class: 'sr-only' }, `, ${split}`));
        }
        if (hasMissing) {
          pill.setAttribute('type', 'button');
          pill.setAttribute('aria-expanded', String(isOpen));
          pill.setAttribute('aria-controls', 'inventory-missing');
          pill.dataset['column'] = col.id;
          pill.dataset['category'] = cat;
          pill.append(el('span', { class: 'sr-only' }, `, ${t('inventory.showMissing')}`));
          if (pill.title === '') pill.title = t('inventory.showMissing');
          pill.addEventListener('click', () => handlers.onCell({ column: col.id, category: cat }));
        }
        td.append(pill);
        // FA-53: the split between "readable as text" and "only visual" is visible in the cell, not only in the tooltip.
        if (cell.asText !== undefined && cell.visual !== undefined && cell.carried > 0) {
          td.append(el('span', { class: 'split', 'aria-hidden': 'true' }, t('inventory.splitShort', { text: cell.asText, visual: cell.visual })));
        }
      } else {
        td.append(el('span', { 'aria-hidden': 'true' }, '–'), el('span', { class: 'sr-only' }, ` ${word}`));
      }
      tr.append(td);
    }
    body.append(tr);
  }
  const table = el('table', { class: 'matrix' }, el('caption', { class: 'sr-only' }, t('inventory.caption')), el('thead', {}, head), body);
  const legend = el('ul', { class: 'legend' });
  for (const s of ['complete', 'partial', 'none'] as const) {
    const st = STATUS[s];
    legend.append(el('li', { class: `cell-${s}` }, icon(st.icon as IconName), t(st.key as Key)));
  }
  legend.append(el('li', { class: 'cell-notInModel' }, el('span', { 'aria-hidden': 'true' }, '–'), t('inventory.legendAbsent')));
  const total = Object.values(inv.totals).reduce((a, b) => a + b, 0);
  const sizes = el('p', { class: 'inventory-note' }, t('inventory.facts', { n: total }), ' · ', t('inventory.hintMissing'));
  const scroller = el('div', { class: 'matrix-scroll', tabindex: '0', role: 'region', 'aria-label': t('inventory.region') }, table);
  const parts: Node[] = [scroller];
  const missing = open ? renderMissing(inv, columnName, open, handlers) : null;
  if (missing) parts.push(missing);
  parts.push(el('div', { class: 'inventory-foot' }, legend, sizes));
  return el('div', { class: 'inventory' }, ...parts);
}

/** The list below the matrix: every fact of the category that the representation does not carry, with its element (FA-54). */
function renderMissing(inv: Inventory, columnName: (id: string) => string, open: MissingSelection, handlers: InventoryHandlers): HTMLElement | null {
  const cell = inv.columns.find((c) => c.id === open.column)?.cells.find((c) => c.category === open.category);
  if (!cell || cell.missing.length === 0) return null;
  const list = el('ul', { class: 'missing-list' });
  for (const { fact, element } of cell.missing) {
    const type = typeName(element.type, getLang());
    const label = element.label ?? t('inventory.noLabel');
    const link = el('button', { type: 'button', class: 'element-link', 'data-element': element.key }, el('span', { class: element.label === undefined ? 'muted' : 'element-label' }, label), el('span', { class: 'element-type' }, ` · ${type} · `), el('span', { class: 'element-id' }, element.key));
    link.setAttribute('aria-label', t('inventory.selectElement', { type, label: element.label ?? element.key }));
    link.addEventListener('click', () => handlers.onElement(element.key));
    list.append(el('li', {}, link, el('span', { class: 'missing-fact' }, `${fact.aspect}: ${fact.value}`)));
  }
  return el(
    'section',
    { class: 'missing', id: 'inventory-missing', 'aria-labelledby': 'inventory-missing-title' },
    el('h2', { class: 'popover-title', id: 'inventory-missing-title' }, t('inventory.missingTitle', { column: columnName(open.column), category: t(`cat.${open.category as 'node'}`), n: cell.missing.length, total: cell.total })),
    el('p', { class: 'muted' }, t('inventory.missingHint')),
    list,
  );
}
