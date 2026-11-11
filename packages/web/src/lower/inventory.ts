import type { Inventory, InventoryCell } from '@repr-werkbank/core';
import { el } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';
import { t, type Key } from '../i18n.ts';

const STATUS: Record<InventoryCell['status'], { key: Key | null; icon: IconName | null }> = {
  complete: { key: 'inventory.complete', icon: 'complete' },
  partial: { key: 'inventory.partial', icon: 'partial' },
  none: { key: 'inventory.none', icon: 'none' },
  notInModel: { key: 'inventory.notInModel', icon: null },
};

/** The matrix of FA-51: category by representation, each cell "n of m" with a symbol and the status as text (never colour alone, UI-06). */
export function renderInventory(inv: Inventory, columnName: (id: string) => string): HTMLElement {
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
        const pill = el('span', { class: 'pill' }, icon(st.icon), t('inventory.cell', { carried: cell.carried, total: cell.total }), el('span', { class: 'sr-only' }, ` ${word}`));
        if (cell.asText !== undefined && cell.visual !== undefined && cell.carried > 0) {
          const split = t('inventory.split', { text: cell.asText, visual: cell.visual });
          pill.title = split;
          pill.append(el('span', { class: 'sr-only' }, `, ${split}`));
        }
        td.append(pill);
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
  const sizes = el('p', { class: 'inventory-note' }, t('inventory.facts', { n: total }));
  const scroller = el('div', { class: 'matrix-scroll', tabindex: '0', role: 'region', 'aria-label': t('inventory.region') }, table);
  return el('div', { class: 'inventory' }, scroller, el('div', { class: 'inventory-foot' }, legend, sizes));
}
