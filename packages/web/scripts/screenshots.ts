import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build, preview } from 'vite';

// Takes the pictures of the built page and checks what they claim (UI-11, plan 3.x "done when").
//   npm run screenshots -w @repr-werkbank/web -- [--out <dir>]
// Without --out the pictures go to a temporary directory. docs/design/ holds the accepted draft and is never written here.

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > 0 && process.argv[outIdx + 1] ? (process.argv[outIdx + 1] as string) : mkdtempSync(join(tmpdir(), 'repr-werkbank-shots-'));

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
const check = (condition: boolean, good: string, bad: string): void => (condition ? ok(good) : fail(bad));

const golden = (example: string): string => readFileSync(join(repo, 'tests/golden', example, 'bundle.json'), 'utf8');
const goldenText = golden('bpmn/order-handling.bpmn');

interface GoldenBundle {
  figures: { rows: { id: string; kind: string; characters: number; lines: number; tokens: number }[] };
  inventory: { categories: string[]; columns: { id: string; cells: { category: string; carried: number; total: number; status: string }[] }[] };
}
const goldenBundle = JSON.parse(goldenText) as GoldenBundle;

const ready = (page: Page): Promise<unknown> => page.waitForFunction(() => typeof window.__reprWerkbank?.bundleJson === 'string');

async function settle(page: Page): Promise<void> {
  await page.waitForSelector('.shell');
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
}

async function checkFonts(page: Page, label: string): Promise<void> {
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')));
  const missing = ['Inter Variable', 'JetBrains Mono Variable'].filter((f) => !loaded.includes(f));
  check(missing.length === 0, `${label}: bundled fonts loaded (${loaded.join(', ')})`, `${label}: fonts not loaded: ${missing.join(', ')}`);
}

async function checkOverflow(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth }));
  check(r.scroll <= r.inner && r.body <= r.inner, `${label}: no horizontal overflow (scrollWidth ${r.scroll} <= ${r.inner})`, `${label}: horizontal overflow, scrollWidth ${r.scroll} > viewport ${r.inner}`);
}

async function checkClipping(page: Page, label: string): Promise<void> {
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('button, th, td, .figures-row, .brand, .pill, .legend li, .tab, .push-button')) {
      if (e.offsetParent === null) continue;
      if (e.scrollWidth > e.clientWidth + 1) out.push(`${e.tagName}.${e.className} "${(e.textContent ?? '').slice(0, 30)}" ${e.scrollWidth}>${e.clientWidth}`);
    }
    const model = document.querySelector<HTMLElement>('.model');
    if (model && model.scrollWidth > model.clientWidth + 1) out.push(`model name is cut with an ellipsis (${model.scrollWidth}>${model.clientWidth})`);
    return out;
  });
  check(clipped.length === 0, `${label}: no clipped text`, `${label}: clipped text: ${clipped.join('; ')}`);
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
    const sel = ['body', '.shell', '.top', '.views', '.view', '.bar', '.select', '.text-scroll', '.line', '.code', '.figures', '.lower', '.lower-tabs', '.lower-panel', '.matrix-scroll', '.matrix .cat', '.matrix thead th', '.icon-button', '.text-button', '.narrow-tabs', '.diagram', '.message', '.popover'];
    const rows: { sel: string; bg: number | null; fg: number | null }[] = [];
    for (const s of sel) {
      const e = document.querySelector(s);
      if (!e || ((e as HTMLElement).offsetParent === null && s !== 'body')) continue;
      const cs = getComputedStyle(e);
      rows.push({ sel: s, bg: lum(cs.backgroundColor), fg: lum(cs.color) });
    }
    return { rows, colorScheme: getComputedStyle(document.documentElement).colorScheme };
  });
  const bad: string[] = [];
  for (const row of r.rows) {
    const dark = scheme === 'dark';
    if (row.bg !== null && (dark ? row.bg > 0.1 : row.bg < 0.5)) bad.push(`${row.sel} background luminance ${row.bg.toFixed(2)}`);
    if (row.fg !== null && (dark ? row.fg < 0.1 : row.fg > 0.25)) bad.push(`${row.sel} text luminance ${row.fg.toFixed(2)}`);
  }
  if (r.colorScheme !== scheme) bad.push(`color-scheme is ${r.colorScheme}`);
  check(bad.length === 0, `${label}: ${scheme} scheme reaches ${r.rows.length} sampled surfaces and form controls`, `${label}: scheme does not reach: ${bad.join('; ')}`);
}

async function checkFigures(page: Page, label: string): Promise<void> {
  const shown = await page.evaluate(() => [...document.querySelectorAll('.view')].map((v) => ({ id: (v.querySelector('select') as HTMLSelectElement).value, text: v.querySelector('.figures-row')?.textContent ?? '' })));
  const fmt = new Intl.NumberFormat('en-US');
  for (const s of shown) {
    const row = goldenBundle.figures.rows.find((r) => r.id === s.id);
    const want = row && row.kind === 'text' ? `${fmt.format(row.characters)} characters · ${fmt.format(row.lines)} lines · ${fmt.format(row.tokens)} tokens (o200k_base)` : '';
    check(s.text === want, `${label}: figures of ${s.id} equal the golden bundle: ${s.text}`, `${label}: figures of ${s.id}: "${s.text}" != golden "${want}"`);
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
  const word: Record<string, string | undefined> = { complete: 'complete', partial: 'partial', none: 'none', notInModel: 'not in this model' };
  let n = 0;
  let wrong = 0;
  inv.categories.forEach((cat, i) => {
    inv.columns.forEach((col, j) => {
      const g = col.cells.find((c) => c.category === cat);
      const shown = cells[i]?.cells[j] ?? '';
      const base = g?.status === 'notInModel' ? `– ${word['notInModel'] ?? ''}` : `${g?.carried} of ${g?.total} ${g ? (word[g.status] ?? '') : ''}`;
      // The diagram column adds how its facts are carried (FA-53) after the status.
      if (shown !== base && !shown.startsWith(`${base}, `)) {
        wrong++;
        fail(`${label}: cell ${cat} x ${col.id}: "${shown}" != golden "${base}"`);
      }
      n++;
    });
  });
  const absentShown = cells.filter((c) => c.absent).length;
  const absentGolden = inv.columns[0]?.cells.filter((c) => c.status === 'notInModel').length ?? 0;
  check(wrong === 0 && absentShown === absentGolden, `${label}: ${n} matrix cells equal the golden inventory; ${absentShown} categories marked as not in this model`, `${label}: ${absentShown} categories marked as not in the model, golden has ${absentGolden}`);
}

async function checkFocus(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return null;
    const cs = getComputedStyle(e);
    return { tag: e.tagName, text: (e.getAttribute('aria-label') ?? e.textContent ?? '').slice(0, 20), style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor };
  });
  check(!!r && r.style !== 'none' && parseFloat(r.width) >= 2, `${label}: keyboard focus on ${r?.tag} "${r?.text}" has outline ${r?.width} ${r?.style} ${r?.colour}`, `${label}: focused element shows no outline (${JSON.stringify(r)})`);
}

/** Counts the interactive controls of the header and of each view bar (UI-03, UI-04). */
async function checkControlCounts(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({
    header: document.querySelectorAll('.top nav button').length,
    bars: [...document.querySelectorAll('.view .bar')].map((b) => b.querySelectorAll('button, select').length),
  }));
  check(r.header <= 6 && r.bars.every((n) => n <= 4), `${label}: header has ${r.header} controls, view bars ${r.bars.join(' and ')}`, `${label}: too many controls: header ${r.header}, bars ${r.bars.join(', ')}`);
}

const bundleOf = (page: Page): Promise<string | null> => page.evaluate(() => window.__reprWerkbank?.bundleJson ?? null);

mkdirSync(outDir, { recursive: true });
await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0 } });
const resolved = server.resolvedUrls?.local[0];
if (!resolved) throw new Error('The preview server has no address');
const url: string = resolved;

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: process.env['PW_CHROMIUM_EXECUTABLE'] ?? '/opt/pw-browsers/chromium' });
  }
}
const browser = await launch();

async function open(viewport: { width: number; height: number }, scheme: Scheme, label: string, extra?: (ctx: BrowserContext) => void): Promise<{ page: Page; context: BrowserContext; errors: string[] }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE, colorScheme: scheme, acceptDownloads: true });
  extra?.(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // R-2: only the page's own origin (and in-page blob and data URLs) may be requested.
  page.on('request', (rq) => {
    const u = rq.url();
    if (!u.startsWith(url) && !u.startsWith('data:') && !u.startsWith('blob:')) fail(`${label}: request outside the page's own origin: ${u}`);
  });
  await page.goto(url);
  await settle(page);
  return { page, context, errors };
}

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(outDir, `${name}.png`) });

try {
  for (const scheme of SCHEMES) {
    for (const [state, viewport] of [['base', WIDE], ['inventory', WIDE], ['narrow', NARROW], ['diagram', WIDE], ['diagram-narrow', NARROW], ['load', WIDE], ['notices', WIDE], ['error', WIDE]] as const) {
      const label = `${state}-${scheme}`;
      const { page, context, errors } = await open(viewport, scheme, label);
      if (state === 'inventory') await page.getByRole('tab', { name: 'Inventory' }).click();
      if (state === 'diagram') await page.selectOption('#rep-b', 'diagram');
      if (state === 'diagram-narrow') {
        await page.getByRole('tab', { name: 'Verbalization' }).click();
        await page.selectOption('#rep-b', 'diagram');
      }
      if (state === 'load') await page.getByRole('button', { name: 'Load' }).click();
      if (state === 'notices') {
        await page.setInputFiles('#file-input', join(repo, 'packages/core/test/fixtures/unsupported-elements.bpmn'));
        await page.waitForSelector('.message');
        await page.getByRole('button', { name: 'Show details' }).click();
      }
      if (state === 'error') {
        await page.setInputFiles('#file-input', join(repo, 'packages/core/test/fixtures/not-wellformed.bpmn'));
        await page.waitForSelector('.message[role="alert"]');
      }
      await settle(page);
      await page.waitForTimeout(250);
      await checkFonts(page, label);
      await checkOverflow(page, label);
      await checkClipping(page, label);
      await checkScheme(page, scheme, label);
      await checkControlCounts(page, label);
      if (state === 'base' || state === 'inventory' || state === 'narrow') await checkFigures(page, label);
      if (state === 'inventory') await checkMatrix(page, label);
      await shot(page, `${state}-${scheme}`);
      if (state === 'base') await checkFocus(page, label);
      if (errors.length > 0) fail(`${label}: errors in the page: ${errors.join('; ')}`);
      if (state === 'narrow') {
        // The opened inventory must not widen the page either.
        await page.getByRole('tab', { name: 'Inventory' }).click();
        await checkOverflow(page, `${label} with inventory opened`);
        await shot(page, `narrow-inventory-${scheme}`);
      }
      await context.close();
    }
  }

  // ---- bundle equality, file input, options, German, cancel ----------------------------------------------------------------------
  {
    const { page, context, errors } = await open(WIDE, 'light', 'flow');
    const first = await bundleOf(page);
    check(first === goldenText, `bundle made in the browser equals the golden bundle.json byte for byte (${first?.length} characters)`, 'bundle made in the browser differs from the golden bundle.json');

    await page.setInputFiles('#file-input', join(repo, 'examples/pnml/producer-consumer.pnml'));
    await page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'producer-consumer.pnml');
    await ready(page);
    const pnml = await bundleOf(page);
    check(pnml === golden('pnml/producer-consumer.pnml'), 'bundle of a PNML file loaded through the file input equals the golden bundle', 'bundle of the PNML file differs from the golden bundle');

    // Pasted text has no file name; a file that is not UTF-8 gives a message and leaves the model in place.
    await page.getByRole('button', { name: 'Load' }).click();
    await page.locator('#paste-text').fill(readFileSync(join(repo, 'examples/pnml/wf-sound.pnml'), 'utf8'));
    await page.getByRole('button', { name: 'Read text' }).click();
    await page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'pasted text');
    await ready(page);
    check((await bundleOf(page))?.includes('"name": null') === true, 'pasted text gives a bundle without an input name', 'pasted text: the bundle has an input name');
    await page.setInputFiles('#file-input', { name: 'latin1.bpmn', mimeType: 'application/xml', buffer: Buffer.from([0x3c, 0x61, 0xe4, 0xff]) });
    await page.getByText('not valid UTF-8').waitFor();
    check((await page.locator('.model-name').textContent()) === 'pasted text', 'after a file that is not UTF-8 the previous model stays', 'the model name changed after an invalid file');

    await page.setInputFiles('#file-input', join(repo, 'examples/pnml/producer-consumer.pnml'));
    await page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'producer-consumer.pnml');
    await ready(page);

    // Changed options give the command line tool's bytes: verbalization in German, JSON indentation 4.
    await page.selectOption('#rep-a', 'json');
    await page.locator('#view-a .bar-buttons button').first().click();
    await page.locator('#view-a-opt-indent').fill('4');
    await page.locator('#view-a').getByRole('button', { name: 'Options' }).click();
    await page.selectOption('#rep-b', 'verbalization');
    await page.locator('#view-b .bar-buttons button').first().click();
    await page.locator('#view-b-opt-language').selectOption('de');
    await page.waitForFunction(() => typeof window.__reprWerkbank?.bundleJson === 'string' && window.__reprWerkbank.bundleJson.includes('"language": "de"'));
    await ready(page);
    const changed = await bundleOf(page);
    const work = mkdtempSync(join(tmpdir(), 'repr-cli-'));
    try {
      execFileSync(process.execPath, [join(repo, 'packages/cli/dist/bin.js'), join(repo, 'examples/pnml'), '--out', work, '--option', 'verbalization.language=de', '--option', 'json.indent=4'], { stdio: 'pipe' });
      const cli = readFileSync(join(work, 'producer-consumer.pnml.bundle.json'), 'utf8');
      check(changed === cli, 'bundle with changed options equals the command line tool with the same --option values', 'bundle with changed options differs from the command line tool');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }

    // The language switch changes the labels; the choice survives a reload (NF-05).
    await page.getByRole('button', { name: /Interface language/ }).click();
    const de = await page.evaluate(() => ({ lang: document.documentElement.lang, load: document.querySelector('.top nav button')?.textContent, tabs: [...document.querySelectorAll('.lower-tabs .tab')].map((t) => t.textContent) }));
    check(de.lang === 'de' && de.load === 'Laden' && de.tabs.join() === 'Übersicht,Inventar,Strukturbericht,Export', `language switch: ${JSON.stringify(de)}`, `language switch failed: ${JSON.stringify(de)}`);
    await shot(page, 'german-light');
    await page.reload();
    await settle(page);
    check((await page.evaluate(() => document.documentElement.lang)) === 'de', 'the language is remembered after a reload', 'the language was not remembered');
    check((await page.locator('.lower-panel').isHidden()) && (await page.locator('#rep-a').inputValue()) === 'json', 'after the reload the lower area is collapsed and the chosen representation is remembered', 'wrong state after reload');
    if (errors.length > 0) fail(`flow: errors in the page: ${errors.join('; ')}`);
    await context.close();
  }

  // ---- soundness: cancel (3.1) ---------------------------------------------------------------------------------------------------
  {
    const { page, context } = await open(WIDE, 'light', 'cancel');
    const workers: { closed: boolean }[] = [];
    page.on('worker', (w) => {
      const entry = { closed: false };
      workers.push(entry);
      w.on('close', () => (entry.closed = true));
    });
    await page.getByRole('button', { name: 'Examples' }).click();
    await page.getByRole('button', { name: /wf-large\.pnml/ }).click();
    await page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'wf-large.pnml');
    await page.getByRole('tab', { name: 'Structure report' }).click();
    // Raise the state limit to its maximum; the search then runs long enough to be cancelled.
    await page.locator('#structure-opt-maxStates').fill('500000');
    await page.getByText('The structure report is being computed').waitFor();
    const before = workers.length;
    await shot(page, 'structure-running');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByText('The computation was cancelled').waitFor();
    check(workers.length === before + 1, 'cancel starts a fresh worker', `cancel did not start one fresh worker (${before} -> ${workers.length})`);
    await page.waitForTimeout(300);
    check(workers.some((w) => w.closed), 'cancel terminated the running worker', 'no worker was terminated');
    check((await bundleOf(page)) === null, 'after cancel there is no bundle', 'a bundle exists after cancel');
    await shot(page, 'structure-cancelled');
    await page.getByRole('tab', { name: 'Export' }).click();
    const exportState = await page.evaluate(() => ({ disabled: document.querySelector<HTMLButtonElement>('.export .push-button')?.disabled, text: document.querySelector('.export')?.textContent ?? '' }));
    check(exportState.disabled === true && exportState.text.includes('cancelled'), 'export is unavailable after cancel, with the reason', `export after cancel: ${JSON.stringify(exportState)}`);
    // The views still show the model (the first result was already there).
    check((await page.locator('#view-a .line').count()) > 10, 'the views still show the model after cancel', 'the views are empty after cancel');
    await page.getByRole('tab', { name: 'Structure report' }).click();
    await page.locator('#structure-opt-maxStates').fill('1000');
    await page.getByText(/not decided|nicht entschieden/i).first().waitFor({ timeout: 60000 }).catch(() => undefined);
    await ready(page);
    check(typeof (await bundleOf(page)) === 'string', 'a new run with a small limit finishes and gives a bundle', 'no bundle after the new run');
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed; pictures in ${outDir}`);
