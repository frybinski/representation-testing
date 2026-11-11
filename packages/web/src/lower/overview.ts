import type { Figures, FigureRow, TextFigureRow } from '@repr-werkbank/core';
import { el } from '../dom.ts';
import { imageFigures } from '../figures-text.ts';
import { formatNumber, t, type Key } from '../i18n.ts';
import { icon } from '../icons.ts';

/** The numeric columns of the overview (FA-62). `rel*` are the sizes relative to the original file. */
export const SORT_KEYS = ['characters', 'lines', 'tokens', 'relCharacters', 'relLines', 'relTokens'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface OverviewSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const COLUMN_LABEL: Record<SortKey, Key> = {
  characters: 'overview.characters',
  lines: 'overview.lines',
  tokens: 'overview.tokens',
  relCharacters: 'overview.relCharacters',
  relLines: 'overview.relLines',
  relTokens: 'overview.relTokens',
};

/** The number of a column for one row; null when the original has none of it (the relative value is then empty). */
export function valueOf(row: TextFigureRow, key: SortKey): number | null {
  switch (key) {
    case 'characters':
    case 'lines':
    case 'tokens':
      return row[key];
    case 'relCharacters':
      return row.relative.characters === null ? null : Number(row.relative.characters);
    case 'relLines':
      return row.relative.lines === null ? null : Number(row.relative.lines);
    case 'relTokens':
      return row.relative.tokens === null ? null : Number(row.relative.tokens);
  }
}

/** Text rows in the order of the sort; without a sort the order of the registry. Stable; rows without a value come last in both directions. */
export function sortRows(rows: readonly TextFigureRow[], sort: OverviewSort | null): TextFigureRow[] {
  const list = [...rows];
  if (!sort) return list;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return list
    .map((row, i) => ({ row, i, v: valueOf(row, sort.key) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      return a.v === b.v ? a.i - b.i : (a.v - b.v) * sign;
    })
    .map((x) => x.row);
}

/** The next state when a column header is activated: ascending, descending, then back to the order of the registry. */
export function nextSort(current: OverviewSort | null, key: SortKey): OverviewSort | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

const ratio = (v: number | null): string => (v === null ? '–' : `× ${formatNumber(v, 2)}`);

/**
 * Overview of all representations (FA-62): size of each text in characters, lines and tokens, absolute and relative to the original file,
 * sortable by every number (a button in the header cell, `aria-sort` on the cell). The diagram has no token count and no relation to the
 * original (FA-40); its row stays at the end with its pixel size and file size.
 */
export function renderOverview(figures: Figures, name: (id: string) => string, sort: OverviewSort | null, onSort: (key: SortKey) => void): HTMLElement {
  const textRows = figures.rows.filter((r): r is TextFigureRow => r.kind === 'text');
  const imageRows = figures.rows.filter((r): r is Extract<FigureRow, { kind: 'image' }> => r.kind === 'image');
  const head = el('tr', {}, el('th', { scope: 'col', class: 'cat-head' }, t('overview.representation')));
  for (const key of SORT_KEYS) {
    const active = sort?.key === key;
    const button = el('button', { type: 'button', class: 'sort-button' }, t(COLUMN_LABEL[key]), icon(active ? (sort?.dir === 'asc' ? 'up' : 'down') : 'sort'));
    button.dataset['sort'] = key;
    button.addEventListener('click', () => onSort(key));
    head.append(el('th', { scope: 'col', class: 'num', 'aria-sort': active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, button));
  }
  const body = el('tbody');
  for (const row of sortRows(textRows, sort)) {
    const tr = el('tr', { 'data-row': row.id }, el('th', { scope: 'row', class: 'cat' }, name(row.id)));
    for (const key of SORT_KEYS) {
      const v = valueOf(row, key);
      tr.append(el('td', { class: 'num' }, key.startsWith('rel') ? ratio(v) : formatNumber(v ?? 0)));
    }
    body.append(tr);
  }
  for (const row of imageRows) {
    body.append(el('tr', { 'data-row': row.id, class: 'image-row' }, el('th', { scope: 'row', class: 'cat' }, name(row.id)), el('td', { colspan: String(SORT_KEYS.length), class: 'image-figures' }, imageFigures(row))));
  }
  const table = el('table', { class: 'matrix overview-table' }, el('caption', { class: 'sr-only' }, t('overview.caption')), el('thead', {}, head), body);
  const note = el('p', { class: 'inventory-note' }, t('overview.note', { tokenizer: figures.tokenizer.name }));
  return el('div', { class: 'inventory overview' }, el('div', { class: 'matrix-scroll', tabindex: '0', role: 'region', 'aria-label': t('overview.region') }, table), note);
}
