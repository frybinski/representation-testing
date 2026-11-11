import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { build, preview } from 'vite';

// Reproduces the six screenshots of the design draft (UI-11) from the built page and checks what the pictures claim.
//   npm run screenshots -w @repr-werkbank/web [-- --extra-dir <dir>]
// --extra-dir additionally writes pictures of the keyboard focus there (not part of the six).

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../../../docs/design/', import.meta.url));
const golden = fileURLToPath(new URL('../../../tests/golden/bpmn/order-handling.bpmn/bundle.json', import.meta.url));
const extraIdx = process.argv.indexOf('--extra-dir');
const extraDir = extraIdx > 0 ? process.argv[extraIdx + 1] : undefined;

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 400, height: 800 };
const SCALE = 2;
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

const failures: string[] = [];
const fail = (msg: string): void => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};
const ok = (msg: string): void => console.log(`ok   ${msg}`);

interface GoldenBundle {
  figures: { rows: { id: string; characters: number; lines: number; tokens: number }[] };
  inventory: { categories: string[]; columns: { id: string; cells: { category: string; carried: number; total: number; status: string }[] }[] };
}
const goldenText = readFileSync(golden, 'utf8');
const goldenBundle = JSON.parse(goldenText) as GoldenBundle;

async function settle(page: Page): Promise<void> {
  await page.waitForSelector('.shell');
  await page.evaluate(() => document.fonts.ready);
}

async function checkFonts(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', ''));
    const ui = getComputedStyle(document.body).fontFamily;
    const mono = getComputedStyle(document.querySelector('.code') ?? document.body).fontFamily;
    return { loaded, ui, mono };
  });
  const need = ['Inter Variable', 'JetBrains Mono Variable'];
  const missing = need.filter((f) => !r.loaded.includes(f));
  if (missing.length > 0) fail(`${label}: fonts not loaded: ${missing.join(', ')}`);
  else ok(`${label}: bundled fonts loaded (${r.loaded.join(', ')})`);
}

async function checkOverflow(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth }));
  if (r.scroll > r.inner || r.body > r.inner) fail(`${label}: horizontal overflow, scrollWidth ${r.scroll} > viewport ${r.inner}`);
  else ok(`${label}: no horizontal overflow (scrollWidth ${r.scroll} <= ${r.inner})`);
}

async function checkClipping(page: Page, label: string): Promise<void> {
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('button, select, th, td, .figures, .brand, .pill, .legend li, .tab')) {
      if (e.offsetParent === null) continue;
      if (e.scrollWidth > e.clientWidth + 1 && e.tagName !== 'SELECT') out.push(`${e.tagName}.${e.className} "${(e.textContent ?? '').slice(0, 30)}" ${e.scrollWidth}>${e.clientWidth}`);
    }
    const model = document.querySelector<HTMLElement>('.model');
    if (model && model.scrollWidth > model.clientWidth + 1) out.push(`model name is cut with an ellipsis (${model.scrollWidth}>${model.clientWidth})`);
    return out;
  });
  if (clipped.length > 0) fail(`${label}: clipped text: ${clipped.join('; ')}`);
  else ok(`${label}: no clipped text`);
}

// The scheme must reach every surface: sampled backgrounds and text colours must be on the dark (or light) side.
async function checkScheme(page: Page, scheme: Scheme, label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const lum = (css: string): number | null => {
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(css) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(css);
      if (!m) return null;
      const isFloat = css.startsWith('color(');
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      if (alpha === 0) return null;
      const ch = [m[1], m[2], m[3]].map((v) => {
        const c = isFloat ? Number(v) : Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const sel = ['body', '.shell', '.top', '.views', '.view', '.bar', '.select', '.text-scroll', '.gutter', '.code', '.figures', '.lower', '.lower-tabs', '.lower-panel', '.matrix-scroll', '.matrix .cat', '.matrix thead th', '.icon-button', '.text-button', '.narrow-tabs'];
    const rows: { sel: string; bg: number | null; fg: number | null }[] = [];
    for (const s of sel) {
      const e = document.querySelector(s);
      if (!e || (e as HTMLElement).offsetParent === null && s !== 'body') continue;
      const cs = getComputedStyle(e);
      rows.push({ sel: s, bg: lum(cs.backgroundColor), fg: lum(cs.color) });
    }
    return { rows, colorScheme: getComputedStyle(document.documentElement).colorScheme };
  });
  const bad: string[] = [];
  for (const row of r.rows) {
    const darkBg = scheme === 'dark';
    if (row.bg !== null && (darkBg ? row.bg > 0.1 : row.bg < 0.5)) bad.push(`${row.sel} background luminance ${row.bg.toFixed(2)}`);
    if (row.fg !== null && (darkBg ? row.fg < 0.1 : row.fg > 0.25)) bad.push(`${row.sel} text luminance ${row.fg.toFixed(2)}`);
  }
  if (r.colorScheme !== scheme) bad.push(`color-scheme is ${r.colorScheme}`);
  if (bad.length > 0) fail(`${label}: scheme does not reach: ${bad.join('; ')}`);
  else ok(`${label}: ${scheme} scheme reaches ${r.rows.length} sampled surfaces and form controls`);
}

async function checkFigures(page: Page, label: string): Promise<void> {
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.view')].map((v) => ({
      id: (v.querySelector('select') as HTMLSelectElement).value,
      text: v.querySelector('.figures')?.textContent ?? '',
    })),
  );
  const fmt = new Intl.NumberFormat('en-US');
  for (const s of shown) {
    const row = goldenBundle.figures.rows.find((r) => r.id === s.id);
    const want = row ? `${fmt.format(row.characters)} characters · ${fmt.format(row.lines)} lines · ${fmt.format(row.tokens)} tokens` : '(no row)';
    if (s.text !== want) fail(`${label}: figures of ${s.id}: "${s.text}" != golden "${want}"`);
    else ok(`${label}: figures of ${s.id} equal the golden bundle: ${s.text}`);
  }
}

async function checkMatrix(page: Page, label: string): Promise<void> {
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll('.matrix tbody tr')].map((tr) => ({
      cells: [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
      absent: tr.classList.contains('is-absent'),
    })),
  );
  const inv = goldenBundle.inventory;
  const word: Record<string, string> = { complete: 'complete', partial: 'partial', none: 'none', notInModel: 'not in this model' };
  let n = 0;
  inv.categories.forEach((cat, i) => {
    inv.columns.forEach((col, j) => {
      const g = col.cells.find((c) => c.category === cat);
      const shown = cells[i]?.cells[j];
      const want = g?.status === 'notInModel' ? `– ${word.notInModel}` : `${g?.carried} of ${g?.total} ${g ? word[g.status] : ''}`;
      if (shown !== want) fail(`${label}: cell ${cat} x ${col.id}: "${shown}" != golden "${want}"`);
      n++;
    });
  });
  const absentShown = cells.filter((c) => c.absent).length;
  const absentGolden = inv.columns[0]?.cells.filter((c) => c.status === 'notInModel').length ?? 0;
  if (absentShown !== absentGolden) fail(`${label}: ${absentShown} categories marked as not in the model, golden has ${absentGolden}`);
  else ok(`${label}: ${n} matrix cells equal the golden inventory; ${absentShown} category/categories marked as not in this model`);
}

async function checkFocus(page: Page, scheme: Scheme, label: string, shot?: string): Promise<void> {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return null;
    const cs = getComputedStyle(e);
    return { tag: e.tagName, text: (e.getAttribute('aria-label') ?? e.textContent ?? '').slice(0, 20), style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor };
  });
  if (!r || r.style === 'none' || parseFloat(r.width) < 2) fail(`${label}: focused element shows no outline (${JSON.stringify(r)})`);
  else ok(`${label}: keyboard focus on ${r.tag} "${r.text}" has outline ${r.width} ${r.style} ${r.colour}`);
  if (shot) await page.screenshot({ path: shot });
  void scheme;
}

mkdirSync(outDir, { recursive: true });
if (extraDir) mkdirSync(extraDir, { recursive: true });
await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('The preview server has no address');
const browser = await chromium.launch();

try {
  let bundleChecked = false;
  for (const scheme of SCHEMES) {
    for (const [state, viewport] of [['base', WIDE], ['inventory', WIDE], ['narrow', NARROW]] as const) {
      const label = `${state}-${scheme}`;
      const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE, colorScheme: scheme });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('request', (rq) => {
        if (!rq.url().startsWith(url) && !rq.url().startsWith('data:')) fail(`${label}: request outside the page's own origin: ${rq.url()}`);
      });
      await page.goto(url);
      await settle(page);

      if (!bundleChecked) {
        const json = await page.evaluate(() => window.__reprWerkbank?.bundleJson ?? null);
        if (json === null) fail('the page made no bundle');
        else if (json === goldenText) ok(`bundle made in the browser equals the golden bundle.json byte for byte (${json.length} characters)`);
        else fail('bundle made in the browser differs from the golden bundle.json');
        bundleChecked = true;
      }

      if (state === 'inventory') await page.getByRole('tab', { name: 'Inventory' }).click();
      await settle(page);
      await checkFonts(page, label);
      await checkOverflow(page, label);
      await checkClipping(page, label);
      await checkScheme(page, scheme, label);
      await checkFigures(page, label);
      if (state === 'inventory') await checkMatrix(page, label);
      await page.screenshot({ path: `${outDir}${state === 'base' ? '1-base' : state === 'inventory' ? '2-inventory' : '3-narrow'}-${scheme}.png` });
      await checkFocus(page, scheme, label, extraDir ? `${extraDir}/focus-${label}.png` : undefined);
      if (errors.length > 0) fail(`${label}: errors in the page: ${errors.join('; ')}`);

      if (state === 'narrow') {
        // Not a picture of the draft: the opened inventory must not widen the page either.
        await page.getByRole('tab', { name: 'Inventory' }).click();
        await checkOverflow(page, `${label} with inventory opened`);
        await page.getByRole('tab', { name: 'Structure report' }).isVisible();
        if (extraDir) await page.screenshot({ path: `${extraDir}/narrow-inventory-${scheme}.png` });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed; pictures in docs/design/');
