import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { golden, launchBrowser, NARROW, openApp, WIDE } from './helpers.ts';

// Checks that used to run inside the screenshot script (H70) and are assertions: fonts, overflow, clipping, the colour scheme on every
// surface, the matrix against the golden inventory. The screenshots stay in scripts/screenshots.ts.
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

interface GoldenBundle {
  inventory: { categories: string[]; columns: { id: string; cells: { category: string; carried: number; total: number; status: string }[] }[] };
}

const luminance = (page: Page, selectors: string[]): Promise<{ sel: string; bg: number | null; fg: number | null }[]> =>
  page.evaluate((sels) => {
    const lum = (css: string): number | null => {
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(css) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(css);
      if (!m) return null;
      const isFloat = css.startsWith('color(');
      if ((m[4] === undefined ? 1 : Number(m[4])) === 0) return null;
      const ch = [m[1], m[2], m[3]].map((v) => {
        const c = isFloat ? Number(v) : Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const out: { sel: string; bg: number | null; fg: number | null }[] = [];
    for (const s of sels) {
      const e = document.querySelector<HTMLElement>(s);
      if (!e || (e.offsetParent === null && s !== 'body')) continue;
      const cs = getComputedStyle(e);
      out.push({ sel: s, bg: lum(cs.backgroundColor), fg: lum(cs.color) });
    }
    return out;
  }, selectors);

const SURFACES = ['body', '.shell', '.top', '.views', '.view', '.bar', '.select', '.text-scroll', '.line', '.code', '.figures', '.lower', '.lower-tabs', '.lower-panel', '.matrix-scroll', '.matrix .cat', '.matrix thead th', '.icon-button', '.text-button', '.narrow-tabs', '.diagram', '.message', '.popover', '.composer', '.preview', '.foot', '.page'];

describe.each([
  ['wide light', WIDE, 'light'],
  ['wide dark', WIDE, 'dark'],
  ['narrow light', NARROW, 'light'],
  ['narrow dark', NARROW, 'dark'],
] as const)('%s', (label, viewport, scheme) => {
  it.each([['base', ''], ['inventory', 'Inventory'], ['overview', 'Overview'], ['structure', 'Structure report'], ['export', 'Export']])('state %s: fonts, no overflow, no clipped text, the scheme reaches every surface', async (_state, tab) => {
    const s = await openApp(browser, { viewport, scheme });
    try {
      if (tab) await s.page.getByRole('tab', { name: tab }).click();
      await s.page.waitForTimeout(250);
      const loaded = await s.page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')));
      expect(loaded).toContain('Inter Variable');
      expect(loaded).toContain('JetBrains Mono Variable');
      const o = await s.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth }));
      expect(o.scroll, `${label} ${tab}: horizontal overflow`).toBeLessThanOrEqual(o.inner);
      expect(o.body).toBeLessThanOrEqual(o.inner);
      const clipped = await s.page.evaluate(() => {
        const out: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>('button, th, td, .figures-row, .brand, .pill, .legend li, .tab, .push-button')) {
          if (e.offsetParent === null) continue;
          if (e.scrollWidth > e.clientWidth + 1) out.push(`${e.tagName}.${e.className} "${(e.textContent ?? '').slice(0, 30)}"`);
        }
        const model = document.querySelector<HTMLElement>('.model');
        if (model && model.scrollWidth > model.clientWidth + 1) out.push('model name is cut');
        return out;
      });
      expect(clipped).toEqual([]);
      const dark = scheme === 'dark';
      const rows = await luminance(s.page, SURFACES);
      const bad = rows.filter((r) => (r.bg !== null && (dark ? r.bg > 0.1 : r.bg < 0.5)) || (r.fg !== null && (dark ? r.fg < 0.1 : r.fg > 0.25)));
      expect(bad).toEqual([]);
      expect(await s.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
});

describe('inventory matrix equals the golden bundle', () => {
  it('shows every cell of the golden inventory with the same numbers and status words', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('tab', { name: 'Inventory' }).click();
      const cells = await s.page.evaluate(() =>
        [...document.querySelectorAll('.matrix tbody tr')].map((tr) => ({ cells: [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()), absent: tr.classList.contains('is-absent') })),
      );
      const inv = (JSON.parse(golden('bpmn/order-handling.bpmn')) as GoldenBundle).inventory;
      const word: Record<string, string> = { complete: 'complete', partial: 'partial', none: 'none', notInModel: 'not in this model' };
      let n = 0;
      inv.categories.forEach((cat, i) => {
        inv.columns.forEach((col, j) => {
          const g = col.cells.find((c) => c.category === cat);
          const shown = cells[i]?.cells[j] ?? '';
          const base = g?.status === 'notInModel' ? `– ${word['notInModel'] as string}` : `${String(g?.carried)} of ${String(g?.total)} ${g ? (word[g.status] as string) : ''}`;
          // A cell with missing facts says so for assistive technology, and the diagram adds how its facts are carried (FA-53).
          expect(shown === base || shown.startsWith(`${base}, `), `${cat} x ${col.id}: "${shown}" vs "${base}"`).toBe(true);
          n++;
        });
      });
      expect(n).toBe(inv.categories.length * inv.columns.length);
      expect(cells.filter((c) => c.absent).length).toBe(inv.columns[0]?.cells.filter((c) => c.status === 'notInModel').length);
      // The diagram column reports text and visual carriage.
      expect(cells.some((c) => c.cells.some((t) => /as text, \d+ only visual/.test(t)))).toBe(true);
    } finally {
      await s.context.close();
    }
  });
});
