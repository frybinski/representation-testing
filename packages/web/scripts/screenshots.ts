import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { build, preview } from 'vite';

// Takes the pictures of the built page (UI-11, §12: the interface is looked at before every report).
//   npm run screenshots -w @repr-werkbank/web -- [--out <dir>]
// Without --out the pictures go to a temporary directory. The final set of milestone M2 is written to docs/screenshots/m2/. The checks that
// this script used to make are assertions in packages/web/e2e (npm run e2e); this script only takes pictures.

const root = fileURLToPath(new URL('..', import.meta.url));
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > 0 && process.argv[outIdx + 1] ? (process.argv[outIdx + 1] as string) : mkdtempSync(join(tmpdir(), 'repr-werkbank-shots-'));

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 400, height: 800 };
const SCHEMES = ['light', 'dark'] as const;

mkdirSync(outDir, { recursive: true });
await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('The preview server has no address');

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: process.env['PW_CHROMIUM_EXECUTABLE'] ?? '/opt/pw-browsers/chromium' });
  }
}
const browser = await launch();

const ready = (page: Page): Promise<unknown> => page.waitForFunction(() => typeof window.__reprWerkbank?.bundleJson === 'string');

interface Shot {
  name: string;
  viewport: { width: number; height: number };
  /** Puts the page into the state to photograph. */
  prepare?: (page: Page) => Promise<void>;
  hash?: string;
}

const SHOTS: Shot[] = [
  { name: 'base-wide', viewport: WIDE },
  { name: 'base-narrow', viewport: NARROW },
  { name: 'overview', viewport: WIDE, prepare: (p) => p.getByRole('tab', { name: 'Overview' }).click() },
  {
    name: 'inventory-missing-facts',
    viewport: WIDE,
    async prepare(p) {
      await p.getByRole('tab', { name: 'Inventory' }).click();
      await p.locator('button.pill[data-column="mermaid"][data-category="dataObject"]').click();
      await p.locator('.element-link').nth(1).click();
    },
  },
  { name: 'inventory-narrow', viewport: NARROW, prepare: (p) => p.getByRole('tab', { name: 'Inventory' }).click() },
  {
    name: 'export-composer',
    viewport: WIDE,
    async prepare(p) {
      await p.getByRole('tab', { name: 'Export' }).click();
      await p.locator('#composer-add').selectOption('mermaid');
      await p.getByRole('button', { name: 'Add', exact: true }).click();
      await p.waitForSelector('.preview');
    },
  },
  {
    name: 'linked-highlight',
    viewport: WIDE,
    async prepare(p) {
      await p.selectOption('#rep-b', 'diagram');
      await p.selectOption('#rep-a', 'mermaid');
      await p.locator('#view-b g[data-element="Valid"]').click();
      await p.waitForSelector('#view-a mark.hl');
    },
  },
  {
    name: 'linked-highlight-original',
    viewport: WIDE,
    async prepare(p) {
      await p.selectOption('#rep-b', 'diagram');
      await p.locator('#view-b g[data-element="Check"]').click();
      await p.waitForSelector('#view-a mark.hl');
    },
  },
  {
    name: 'diagram-narrow',
    viewport: NARROW,
    async prepare(p) {
      await p.getByRole('tab', { name: 'Verbalization' }).click();
      await p.selectOption('#rep-b', 'diagram');
    },
  },
  { name: 'about', viewport: WIDE, hash: '#/about' },
  { name: 'about-narrow', viewport: NARROW, hash: '#/about' },
  {
    name: 'formats',
    viewport: WIDE,
    hash: '#/formats',
    async prepare(p) {
      await p.locator('#format-mermaid').scrollIntoViewIfNeeded();
      await p.locator('#format-mermaid summary').click();
    },
  },
  { name: 'legal', viewport: WIDE, hash: '#/legal' },
  { name: 'german', viewport: WIDE, prepare: (p) => p.getByRole('button', { name: /Interface language/ }).click() },
];

try {
  for (const scheme of SCHEMES) {
    for (const shot of SHOTS) {
      const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 2, colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(url + (shot.hash ?? ''));
      await page.waitForSelector('.shell');
      await ready(page);
      await page.evaluate(() => document.fonts.ready);
      await shot.prepare?.(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `${shot.name}-${scheme}.png`) });
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
console.log(`pictures in ${outDir}`);
