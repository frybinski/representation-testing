// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry, loadDefaultTokenizer, parseModel, promptBlock, computeInventory, type TextFigureRow, type Tokenizer } from '@repr-werkbank/core';
import { setLang } from '../src/i18n.ts';
import { ExportPanel, type ExportInput } from '../src/lower/export.ts';
import { renderInventory } from '../src/lower/inventory.ts';
import { nextSort, sortRows, valueOf } from '../src/lower/overview.ts';
import { PromptCache, promptOf } from '../src/pipeline.ts';

const root = join(import.meta.dirname, '../../..');
const text = readFileSync(join(root, 'examples/bpmn/order-handling.bpmn'), 'utf8');
const registry = createDefaultRegistry();
let tokenizer: Tokenizer;
beforeAll(async () => {
  tokenizer = await loadDefaultTokenizer();
  setLang('en');
});

const row = (id: string, characters: number, rel: string | null): TextFigureRow => ({ id, kind: 'text', characters, lines: 1, tokens: characters, tokenizer: 'x', relative: { characters: rel, lines: rel, tokens: rel } });

describe('overview sorting (FA-62)', () => {
  const rows = [row('a', 30, '0.3000'), row('b', 10, null), row('c', 20, '0.2000')];

  it('keeps the order of the registry without a sort and sorts by every numeric column', () => {
    expect(sortRows(rows, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, { key: 'characters', dir: 'asc' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, { key: 'characters', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, { key: 'relTokens', dir: 'asc' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    // A row without a relative value stays last in both directions.
    expect(sortRows(rows, { key: 'relTokens', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(valueOf(rows[0] as TextFigureRow, 'relLines')).toBe(0.3);
  });

  it('cycles ascending, descending, off', () => {
    const a = nextSort(null, 'lines');
    expect(a).toEqual({ key: 'lines', dir: 'asc' });
    const d = nextSort(a, 'lines');
    expect(d).toEqual({ key: 'lines', dir: 'desc' });
    expect(nextSort(d, 'lines')).toBeNull();
    expect(nextSort(d, 'tokens')).toEqual({ key: 'tokens', dir: 'asc' });
  });
});

describe('inventory with missing facts (FA-54)', () => {
  const model = parseModel(text);
  const inventory = computeInventory(registry, model);
  const name = (id: string): string => id;

  it('makes exactly the cells with missing facts buttons', () => {
    const el = renderInventory(inventory, name, null, { onCell: () => undefined, onElement: () => undefined });
    const buttons = [...el.querySelectorAll('button.pill')];
    const expected = inventory.columns.flatMap((c) => c.cells).filter((c) => c.missing.length > 0).length;
    expect(buttons).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#inventory-missing')).toBeNull();
  });

  it('lists the missing facts with their elements and selects an element on activation', () => {
    const col = inventory.columns.find((c) => c.id === 'mermaid');
    const cell = col?.cells.find((c) => c.missing.length > 0);
    expect(cell).toBeDefined();
    const picked: string[] = [];
    const el = renderInventory(inventory, name, { column: 'mermaid', category: (cell as NonNullable<typeof cell>).category }, { onCell: () => undefined, onElement: (k) => picked.push(k) });
    const list = el.querySelector('#inventory-missing');
    expect(list).not.toBeNull();
    const links = [...(list as Element).querySelectorAll<HTMLButtonElement>('button.element-link')];
    expect(links).toHaveLength((cell as NonNullable<typeof cell>).missing.length);
    expect(links.map((l) => l.dataset['element'])).toEqual((cell as NonNullable<typeof cell>).missing.map((m) => m.element.key));
    links[0]?.click();
    expect(picked).toEqual([links[0]?.dataset['element']]);
    expect(el.querySelector('button.pill[aria-expanded="true"]')).not.toBeNull();
  });
});

describe('prompt block in the worker (FA-71)', () => {
  const req = (steps: string[], header: boolean) => ({ type: 'prompt' as const, id: 1, text, inputName: 'order-handling.bpmn', options: { verbalization: { language: 'de' } }, steps, header });

  it('is exactly the core prompt block, with and without header', () => {
    for (const header of [true, false]) {
      const result = promptOf(req(['verbalization', 'mermaid', 'structure-report'], header), tokenizer, registry);
      const model = parseModel(text);
      const direct = promptBlock(registry, model, [{ generator: 'verbalization', options: { language: 'de' } }, { generator: 'mermaid' }, { generator: 'structure-report' }], { header, inputName: 'order-handling.bpmn' });
      expect(result.text).toBe(direct.text);
      expect(result.characters).toBe(Array.from(direct.text).length);
      expect(result.tokens).toBe(tokenizer.count(direct.text));
    }
  });

  it('keeps generator outputs for the same text, drops them for another', () => {
    const cache = new PromptCache();
    const model = cache.modelOf(text);
    expect(cache.modelOf(text)).toBe(model);
    const wrapped = cache.wrap(registry);
    expect(wrapped.run('mermaid', model)).toBe(wrapped.run('mermaid', model));
    expect(cache.modelOf(text.replace('Check order', 'Check orders'))).not.toBe(model);
  });
});

describe('export panel (FA-28)', () => {
  const steps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const input = (over: Partial<ExportInput> = {}): ExportInput => ({ steps, available: [{ id: 'd', name: 'D' }], header: true, preview: { status: 'empty' }, bundle: 'ready', ...over });

  it('has keyboard operable buttons that move, remove and add', () => {
    const calls: string[] = [];
    const panel = new ExportPanel({
      add: (id) => calls.push(`add ${id}`),
      remove: (i) => calls.push(`remove ${i}`),
      move: (i, d) => calls.push(`move ${i} ${d}`),
      setHeader: (on) => calls.push(`header ${on}`),
      copy: () => calls.push('copy'),
      save: () => calls.push('save'),
      saveBundle: () => calls.push('bundle'),
    });
    document.body.append(panel.root);
    panel.update(input());
    const q = (a: string, i: number): HTMLButtonElement => panel.root.querySelector(`[data-action="${a}"][data-index="${i}"]`) as HTMLButtonElement;
    // The ends cannot move further; every button is a real button with a name for assistive technology.
    expect(q('up', 0).disabled).toBe(true);
    expect(q('down', 2).disabled).toBe(true);
    for (const b of panel.root.querySelectorAll('.composer-item button')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('aria-label')).toMatch(/[ABC]/);
    }
    q('down', 0).click();
    q('up', 2).click();
    q('remove', 1).click();
    (panel.root.querySelector('#composer-add') as HTMLSelectElement).value = 'd';
    (panel.root.querySelector('.composer-add button') as HTMLButtonElement).click();
    const header = panel.root.querySelector('#composer-header') as HTMLInputElement;
    header.checked = false;
    header.dispatchEvent(new Event('change'));
    expect(calls).toEqual(['move 0 1', 'move 2 -1', 'remove 1', 'add d', 'header false']);
    panel.root.remove();
  });

  it('shows the preview, enables copy and save only for a finished block, and explains a missing bundle', () => {
    const panel = new ExportPanel({ add() {}, remove() {}, move() {}, setHeader() {}, copy() {}, save() {}, saveBundle() {} });
    panel.update(input({ preview: { status: 'ready', text: '# x\n\nbody', figures: '9 characters' }, bundle: 'computing' }));
    expect(panel.root.querySelector('.preview')?.textContent).toBe('# x\n\nbody');
    const buttons = [...panel.root.querySelectorAll<HTMLButtonElement>('.composer-preview .push-button')];
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
    expect((panel.root.querySelector('.export-bundle .push-button') as HTMLButtonElement).disabled).toBe(true);
    panel.update(input({ preview: { status: 'blocked', reason: 'later' }, bundle: 'cancelled' }));
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(panel.root.querySelector('.preview')?.textContent).toBe('');
    expect(panel.root.textContent).toContain('later');
  });
});
