import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { createDefaultRegistry } from '@repr-werkbank/core';
import { foreignRequests, golden, launchBrowser, modelLoaded, NARROW, openApp, WIDE, type Session } from './helpers.ts';

// Acceptance of milestone M2, Planung.md section 8 (docs/acceptance-m2.md names each test).
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

const goldenFigures = (id: string): { characters: number; lines: number; tokens: number } => {
  const bundle = JSON.parse(golden('bpmn/order-handling.bpmn')) as { figures: { rows: { id: string; kind: string; characters: number; lines: number; tokens: number }[] } };
  return bundle.figures.rows.find((r) => r.id === id) as { characters: number; lines: number; tokens: number };
};

describe('M2 acceptance 2: after opening, an example is loaded with both views and their figures lines; the lower area is collapsed', () => {
  let s: Session;
  beforeAll(async () => {
    s = await openApp(browser);
  });
  afterAll(async () => {
    await s.context.close();
  });

  it('shows the first example in two filled views', async () => {
    expect(await s.page.locator('.model-name').textContent()).toBe('order-handling.bpmn');
    expect(await s.page.locator('#rep-a').inputValue()).toBe('original');
    expect(await s.page.locator('#rep-b').inputValue()).toBe('verbalization');
    expect(await s.page.locator('#view-a .line').count()).toBeGreaterThan(100);
    expect(await s.page.locator('#view-b .line').count()).toBeGreaterThan(10);
  });

  it('shows the figures line of each view with the tokenizer next to the count, equal to the golden bundle', async () => {
    const fmt = new Intl.NumberFormat('en-US');
    for (const [view, id] of [['a', 'original'], ['b', 'verbalization']] as const) {
      const g = goldenFigures(id);
      expect(await s.page.locator(`#view-${view} .figures-row`).textContent()).toBe(`${fmt.format(g.characters)} characters · ${fmt.format(g.lines)} lines · ${fmt.format(g.tokens)} tokens (o200k_base)`);
    }
  });

  it('keeps the lower area collapsed, with no tab open', async () => {
    expect(await s.page.locator('.lower-panel').isHidden()).toBe(true);
    expect(await s.page.locator('.lower-tabs [aria-selected="true"]').count()).toBe(0);
    expect(await s.page.locator('.lower').getAttribute('data-open')).toBe('false');
  });

  it('starts collapsed again after a reload even when a tab was open (UI-02)', async () => {
    await s.page.getByRole('tab', { name: 'Inventory' }).click();
    await s.page.reload();
    await modelLoaded(s.page, 'order-handling.bpmn');
    expect(await s.page.locator('.lower-panel').isHidden()).toBe(true);
  });
});

describe('M2 acceptance 3: at 1440 x 900 the header, both views and both figures lines are visible without scrolling', () => {
  it('fits, with at most 6 header controls and at most 4 per view bar', async () => {
    const s = await openApp(browser, { viewport: WIDE });
    try {
      const r = await s.page.evaluate(() => {
        const box = (sel: string): { top: number; bottom: number; left: number; right: number } | null => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
        };
        return {
          header: box('.top'),
          figuresA: box('#view-a .figures-row'),
          figuresB: box('#view-b .figures-row'),
          viewA: box('#view-a'),
          viewB: box('#view-b'),
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          headerControls: document.querySelectorAll('.top nav button, .top nav a').length,
          barControls: [...document.querySelectorAll('.view .bar')].map((b) => b.querySelectorAll('button, select, a, input').length),
        };
      });
      expect(r.header?.top).toBe(0);
      for (const f of [r.figuresA, r.figuresB]) {
        expect(f).not.toBeNull();
        expect((f?.bottom ?? Infinity) <= r.innerHeight).toBe(true);
      }
      expect((r.viewA?.right ?? 0) <= (r.viewB?.left ?? 0) + 1).toBe(true);
      expect(r.scrollHeight).toBeLessThanOrEqual(r.innerHeight);
      expect(r.scrollWidth).toBeLessThanOrEqual(r.innerWidth);
      expect(r.headerControls).toBe(6);
      expect(r.barControls).toEqual([4, 4]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
});

describe('M2 acceptance 4: inventory, overview, structure report and export are each one click away', () => {
  it('opens each lower tab with one click and shows its content', async () => {
    const s = await openApp(browser);
    try {
      const expected: [string, string][] = [
        ['Overview', '.overview-table'],
        ['Inventory', '.matrix'],
        ['Structure report', '.report'],
        ['Export', '.composer'],
      ];
      for (const [name, selector] of expected) {
        await s.page.getByRole('tab', { name }).click();
        await s.page.locator(`.lower-panel ${selector}`).first().waitFor({ state: 'visible' });
        expect(await s.page.locator('.lower-tabs [aria-selected="true"]').count(), name).toBe(1);
        expect(await s.page.getByRole('tab', { name }).getAttribute('aria-selected'), name).toBe('true');
      }
      // The tab strip is generated from one list: four tabs, and a second click collapses the area again.
      expect(await s.page.locator('.lower-tabs [role="tab"]').count()).toBe(4);
      await s.page.getByRole('tab', { name: 'Export' }).click();
      expect(await s.page.locator('.lower-panel').isHidden()).toBe(true);
    } finally {
      await s.context.close();
    }
  });

  it('lists the missing facts of an inventory cell below the matrix and selects an element in the views (FA-54, FA-61)', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('tab', { name: 'Inventory' }).click();
      const cell = s.page.locator('button.pill[data-column="mermaid"]').first();
      await cell.click();
      const list = s.page.locator('#inventory-missing');
      await list.waitFor();
      expect(await list.locator('li').count()).toBeGreaterThan(0);
      const first = list.locator('button.element-link').first();
      const key = await first.getAttribute('data-element');
      await first.click();
      await s.page.locator('#view-a mark.hl').first().waitFor();
      expect(key).toBeTruthy();
      expect(await s.page.locator('#view-a mark.hl').count()).toBeGreaterThan(0);
    } finally {
      await s.context.close();
    }
  });

  it('sorts the overview by a numeric column', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('tab', { name: 'Overview' }).click();
      const order = async (): Promise<string[]> => s.page.locator('.overview-table tbody tr[data-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row') ?? ''));
      const before = await order();
      await s.page.locator('.sort-button[data-sort="tokens"]').click();
      expect(await s.page.locator('th[aria-sort="ascending"]').count()).toBe(1);
      const asc = await order();
      expect(asc.at(-1)).toBe('diagram');
      expect(asc[0]).toBe('mermaid');
      await s.page.locator('.sort-button[data-sort="tokens"]').click();
      expect(await s.page.locator('th[aria-sort="descending"]').count()).toBe(1);
      expect((await order())[0]).toBe('original');
      await s.page.locator('.sort-button[data-sort="tokens"]').click();
      expect(await order()).toEqual(before);
    } finally {
      await s.context.close();
    }
  });
});

describe('M2 acceptance 6: selecting a node in the diagram highlights the place in Mermaid, JSON and verbalization', () => {
  it.each([
    ['mermaid', 'Check'],
    ['json', 'Check'],
    ['verbalization', 'Check order'],
  ])('%s: the ranges of the selected node are marked', async (rep, needle) => {
    const s = await openApp(browser);
    try {
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.selectOption('#rep-a', rep);
      const node = s.page.locator('#view-b g[data-element="Check"]');
      expect(await node.getAttribute('role')).toBe('button');
      expect(await node.getAttribute('aria-label')).toContain('Check order');
      await node.click();
      await s.page.locator('#view-a mark.hl').first().waitFor();
      const marked = (await s.page.locator('#view-a mark.hl').allTextContents()).join('');
      expect(marked, `marked text in ${rep}`).toContain(needle);
      expect(await s.page.locator('#view-b g.is-selected').getAttribute('data-element')).toBe('Check');
      // The other nodes are not marked: the marks are the node's ranges, a small part of the text.
      expect(marked.length).toBeLessThan(0.5 * (await s.page.locator('#view-a .code').textContent())!.length);
      // The selection is announced, and Escape clears it.
      await s.page.waitForFunction(() => /Check order/.test(document.querySelector('[role="status"][aria-live]')?.textContent ?? ''));
      await s.page.keyboard.press('Escape');
      expect(await s.page.locator('#view-a mark.hl').count()).toBe(0);
      expect(await s.page.locator('#view-b g.is-selected').count()).toBe(0);
    } finally {
      await s.context.close();
    }
  });

  it('works with the keyboard: Enter on a focused diagram element selects it', async () => {
    const s = await openApp(browser);
    try {
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.locator('#view-b g[data-element="Valid"]').focus();
      await s.page.keyboard.press('Enter');
      await s.page.locator('#view-a mark.hl').first().waitFor();
      expect((await s.page.locator('#view-a mark.hl').allTextContents()).join('')).toContain('Valid');
    } finally {
      await s.context.close();
    }
  });

  it('a click in a text view selects the innermost element and marks it in the diagram', async () => {
    const s = await openApp(browser);
    try {
      await s.page.selectOption('#rep-b', 'diagram');
      // Line 10 of the original file is the user task "Check".
      await s.page.locator('#view-a .line').nth(9).locator('.lt').click({ position: { x: 60, y: 5 } });
      await s.page.locator('#view-b g.is-selected').waitFor();
      expect(await s.page.locator('#view-b g.is-selected').getAttribute('data-element')).toBe('Check');
    } finally {
      await s.context.close();
    }
  });
});

describe('M2 acceptance 8: usable at 400 px width and in the dark scheme', () => {
  it('has no horizontal scroll and reaches every control with the keyboard, each with a visible focus', async () => {
    const s = await openApp(browser, { viewport: NARROW, scheme: 'dark' });
    try {
      const overflow = await s.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        await s.page.keyboard.press('Tab');
        const r = await s.page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null;
          if (!e || e === document.body) return null;
          const cs = getComputedStyle(e);
          const b = e.getBoundingClientRect();
          return { name: e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30) ?? e.tagName, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), inside: b.left >= -1 && b.right <= window.innerWidth + 1 };
        });
        if (!r) continue;
        seen.push(r.name);
        expect(r.outline !== 'none' && r.width >= 2, `focus ring on ${r.name}`).toBe(true);
        expect(r.inside, `${r.name} inside the viewport`).toBe(true);
      }
      for (const name of ['Load', 'Examples', 'About', 'Formats', 'Overview', 'Inventory', 'Structure report', 'Export']) expect(seen.some((n) => n === name), `${name} is reachable by Tab`).toBe(true);
      expect(seen.some((n) => /Interface language/.test(n))).toBe(true);
      expect(seen.some((n) => /Colour scheme/.test(n))).toBe(true);
      // Both views are reachable as tabs on the narrow screen.
      await s.page.getByRole('tab', { name: 'Verbalization' }).click();
      expect(await s.page.locator('#view-b').isVisible()).toBe(true);
      expect(await s.page.locator('#view-a').isVisible()).toBe(false);
      await s.page.getByRole('tab', { name: 'Inventory' }).last().click();
      const after = await s.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(after.scroll).toBeLessThanOrEqual(after.inner);
    } finally {
      await s.context.close();
    }
  });

  it('shows the dark scheme on every surface and keeps it when toggled', async () => {
    const s = await openApp(browser, { viewport: NARROW, scheme: 'dark' });
    try {
      const bg = async (sel: string): Promise<string> => s.page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
      // Tokens: dark bg #111113, surface #18181B.
      expect(await bg('body')).toBe('rgb(17, 17, 19)');
      expect(await s.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
      await s.page.getByRole('button', { name: /Colour scheme/ }).click();
      expect(await bg('body')).toBe('rgb(250, 250, 249)');
      await s.page.reload();
      await modelLoaded(s.page, 'order-handling.bpmn');
      expect(await bg('body')).toBe('rgb(250, 250, 249)');
    } finally {
      await s.context.close();
    }
  });

  it('shows the diagram at the width of the screen, aligned to the top (fit)', async () => {
    const s = await openApp(browser, { viewport: NARROW });
    try {
      await s.page.getByRole('tab', { name: 'Verbalization' }).click();
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.waitForTimeout(300);
      const r = await s.page.evaluate(() => {
        const box = document.querySelector('#view-b .diagram')!.getBoundingClientRect();
        const svg = document.querySelector('#view-b .diagram-stage svg')!.getBoundingClientRect();
        return { boxTop: box.top, boxLeft: box.left, svgTop: svg.top, svgLeft: svg.left, svgWidth: svg.width, boxWidth: box.width };
      });
      expect(r.svgTop - r.boxTop).toBeLessThan(40);
      // Not tiny: at least the readable minimum scale of the fit (the drawing is 1063 px wide).
      expect(r.svgWidth).toBeGreaterThanOrEqual(1063 * 0.4 - 1);
      expect(r.svgLeft - r.boxLeft).toBeLessThan(40);
    } finally {
      await s.context.close();
    }
  });
});

describe('language switch', () => {
  it('changes every visible label and is remembered after a reload', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('button', { name: /Interface language/ }).click();
      const de = await s.page.evaluate(() => ({
        lang: document.documentElement.lang,
        nav: [...document.querySelectorAll('.top nav button, .top nav a')].map((e) => e.textContent),
        tabs: [...document.querySelectorAll('.lower-tabs .tab')].map((t) => t.textContent),
        figures: document.querySelector('#view-a .figures-row')?.textContent ?? '',
        options: [...document.querySelectorAll('#rep-a option')].map((o) => o.textContent),
        modelLabel: document.querySelector('.model')?.textContent ?? '',
      }));
      expect(de.lang).toBe('de');
      expect(de.nav.filter((x) => x !== 'EN|DE' && x !== '')).toEqual(['Laden', 'Beispiele', 'Über', 'Formate']);
      expect(de.tabs).toEqual(['Übersicht', 'Inventar', 'Strukturbericht', 'Export']);
      expect(de.figures).toMatch(/Zeichen · .* Zeilen · .* Tokens/);
      expect(de.modelLabel).toMatch(/^Modell:/);
      const registry = createDefaultRegistry();
      expect(de.options).toContain(registry.get('verbalization').name.de);
      expect(de.options).toContain(registry.get('mermaid').name.de);
      await s.page.reload();
      await modelLoaded(s.page, 'order-handling.bpmn');
      expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('de');
    } finally {
      await s.context.close();
    }
  });

  it('has the example descriptions and the pages in German', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('button', { name: /Interface language/ }).click();
      await s.page.getByRole('button', { name: 'Beispiele' }).click();
      expect(await s.page.locator('.example', { hasText: 'order-handling.bpmn' }).locator('.example-desc').textContent()).toMatch(/Ein Prozess mit Diagrammdaten/);
      await s.page.keyboard.press('Escape');
      await s.page.getByRole('link', { name: 'Über' }).click();
      await s.page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Über repr-werkbank');
      expect(await s.page.title()).toContain('Über repr-werkbank');
    } finally {
      await s.context.close();
    }
  });
});

describe('pages and routing (FA-80 to FA-82, E-6)', () => {
  it('opens About, Formats and Legal by hash, shows the version, and links the legal page from About and the footer', async () => {
    const s = await openApp(browser, { hash: '#/about' });
    try {
      // The first example loads behind the page; the page stays (a deep link must not be thrown back to the workspace).
      await s.page.waitForTimeout(500);
      expect(s.page.url()).toMatch(/#\/about$/);
      expect(await s.page.locator('h1').textContent()).toBe('About repr-werkbank');
      const hrefs = await s.page.locator('.page a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
      expect(hrefs).toContain('https://doi.org/10.1007/978-3-032-40377-3_3');
      expect(hrefs).toContain('https://github.com/frybinski/representation-testing');
      expect(hrefs).toContain('#/legal');
      expect(await s.page.locator('.foot').textContent()).toMatch(/repr-werkbank \d+\.\d+\.\d+/);
      expect(await s.page.locator('.foot a').getAttribute('href')).toBe('#/legal');
      // The header does not link the legal page.
      expect(await s.page.locator('.top a[href="#/legal"]').count()).toBe(0);
      await s.page.getByRole('link', { name: 'Formats' }).click();
      await s.page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Formats');
      for (const def of createDefaultRegistry().list()) expect(await s.page.locator(`#format-${def.id}`).count(), def.id).toBe(1);
      await s.page.locator('#format-diagram svg').first().waitFor();
      await s.page.locator('#format-compact').getByText(/Rules and grammar/).click();
      await s.page.locator('#format-compact pre.reference').filter({ hasText: 'document' }).waitFor();
      await s.page.getByRole('link', { name: 'Legal notice' }).click();
      expect(await s.page.locator('.placeholder').textContent()).toContain('Placeholder.');
      await s.page.getByRole('link', { name: '← Back to the workspace' }).click();
      expect(await s.page.locator('#view-a .line').count()).toBeGreaterThan(10);
      expect(await s.page.getByRole('link', { name: 'About' }).count()).toBe(1);
      expect(foreignRequests(s.requests)).toEqual([]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('serves THIRD_PARTY_LICENSES.txt from the build', async () => {
    const s = await openApp(browser);
    try {
      const res = await s.page.request.get(new URL('THIRD_PARTY_LICENSES.txt', s.page.url()).href);
      expect(res.status()).toBe(200);
      const text = await res.text();
      for (const name of ['@dagrejs/dagre', 'gpt-tokenizer', 'saxes', 'xmlchars', 'Inter (font)']) expect(text).toContain(name);
    } finally {
      await s.context.close();
    }
  });
});
