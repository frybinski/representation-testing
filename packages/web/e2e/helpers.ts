import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const baseUrl = (): string => {
  const url = process.env['E2E_BASE_URL'];
  if (!url) throw new Error('E2E_BASE_URL is not set; run the tests with `npm run e2e`');
  return url;
};

export const WIDE = { width: 1440, height: 900 };
export const NARROW = { width: 400, height: 800 };

/** Chromium: the one Playwright installed, else `PW_CHROMIUM_EXECUTABLE`, else `/opt/pw-browsers/chromium` when it exists. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (first) {
    const fallback = process.env['PW_CHROMIUM_EXECUTABLE'] ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    if (!fallback) throw first;
    return chromium.launch({ executablePath: fallback });
  }
}

export interface Session {
  page: Page;
  context: BrowserContext;
  /** Every URL the page requested. */
  requests: string[];
  /** Errors in the page (exceptions and console errors). */
  errors: string[];
}

export async function openApp(browser: Browser, opts: { viewport?: { width: number; height: number }; scheme?: 'light' | 'dark'; hash?: string; init?: string } = {}): Promise<Session> {
  const context = await browser.newContext({ viewport: opts.viewport ?? WIDE, colorScheme: opts.scheme ?? 'light', acceptDownloads: true, deviceScaleFactor: 1 });
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(baseUrl() + (opts.hash ?? ''));
  await settle(page);
  return { page, context, requests, errors };
}

/** The first model is loaded, shown and its bundle is complete. */
export async function settle(page: Page): Promise<void> {
  await page.waitForSelector('.shell');
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
}

export const ready = (page: Page): Promise<unknown> => page.waitForFunction(() => typeof window.__reprWerkbank?.bundleJson === 'string');
export const bundleOf = (page: Page): Promise<string | null> => page.evaluate(() => window.__reprWerkbank?.bundleJson ?? null);

/** Waits for the named model to be shown and its bundle complete. */
export async function modelLoaded(page: Page, name: string): Promise<void> {
  await page.waitForFunction((n) => document.querySelector('.model-name')?.textContent === n, name);
  await ready(page);
}

/** Only the page's own origin, `data:` and `blob:` URLs (R-2). Returns the offenders. */
export function foreignRequests(requests: readonly string[]): string[] {
  const origin = baseUrl();
  return requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
}

export const golden = (example: string): string => readFileSync(join(repo, 'tests/golden', example, 'bundle.json'), 'utf8');

/** Runs the built command line tool on a directory with one model and returns the bundle it writes (same options as the page). */
export function cliBundle(modelPath: string, options: string[]): string {
  const input = mkdtempSync(join(tmpdir(), 'repr-e2e-in-'));
  const out = mkdtempSync(join(tmpdir(), 'repr-e2e-out-'));
  try {
    const name = modelPath.slice(modelPath.lastIndexOf('/') + 1);
    writeFileSync(join(input, name), readFileSync(modelPath));
    execFileSync(process.execPath, [join(repo, 'packages/cli/dist/bin.js'), input, '--out', out, ...options.flatMap((o) => ['--option', o])], { stdio: 'pipe' });
    return readFileSync(join(out, `${name}.bundle.json`), 'utf8');
  } finally {
    rmSync(input, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

/** Writes text to a temporary file and returns its path (for `setInputFiles`). */
export function tempFile(name: string, content: string): { path: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'repr-e2e-file-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Reads the bytes of a download that Playwright caught. */
export async function downloadText(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') };
}
