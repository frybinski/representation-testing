import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { createDefaultRegistry, parseModel, promptBlock } from '@repr-werkbank/core';
import { bundleOf, cliBundle, downloadText, golden, launchBrowser, modelLoaded, openApp, ready, repo } from './helpers.ts';

// M2 acceptance 7: the bundle made in the page is identical to the command line tool's for the same file and options.
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

async function saveBundle(page: Page): Promise<{ name: string; text: string }> {
  await page.getByRole('tab', { name: 'Export' }).click();
  const button = page.getByRole('button', { name: 'Save the bundle (JSON)' });
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.export-bundle .push-button')?.disabled);
  return downloadText(page, () => button.click());
}

async function pickExample(page: Page, file: string): Promise<void> {
  await page.getByRole('button', { name: 'Examples' }).click();
  await page.getByRole('button', { name: new RegExp(file.replace('.', '\\.')) }).click();
  await modelLoaded(page, file);
}

describe('M2 acceptance 7: bundle of the page equals the command line tool', () => {
  it.each([
    ['bpmn', 'order-handling.bpmn'],
    ['bpmn', 'collaboration.bpmn'],
    ['pnml', 'producer-consumer.pnml'],
    ['pnml', 'pm4py-dialect.pnml'],
    ['pnml', 'wf-sound.pnml'],
  ])('default options, %s example %s: the downloaded file equals the golden bundle and the CLI output', async (folder, file) => {
    const s = await openApp(browser);
    try {
      if (file !== 'order-handling.bpmn') await pickExample(s.page, file);
      const saved = await saveBundle(s.page);
      expect(saved.name).toBe(`${file.replace(/\.[^.]+$/, '')}.bundle.json`);
      expect(saved.text).toBe(golden(`${folder}/${file}`));
      expect(saved.text).toBe(cliBundle(join(repo, 'examples', folder, file), []));
      expect(await bundleOf(s.page)).toBe(saved.text);
    } finally {
      await s.context.close();
    }
  });

  it('BPMN with changed options (json indent 4, verbalization in German, diagram layout automatic) equals the CLI', async () => {
    const s = await openApp(browser);
    try {
      await s.page.selectOption('#rep-a', 'json');
      await s.page.getByRole('button', { name: 'Options' }).first().click();
      await s.page.locator('#view-a-opt-indent').fill('4');
      await s.page.keyboard.press('Escape');
      await s.page.locator('#view-b .bar-buttons button').first().click();
      await s.page.locator('#view-b-opt-language').selectOption('de');
      await s.page.keyboard.press('Escape');
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.locator('#view-b .bar-buttons button').first().click();
      await s.page.locator('#view-b-opt-layout').selectOption('auto');
      await s.page.keyboard.press('Escape');
      await s.page.waitForFunction(() => window.__reprWerkbank?.bundleJson?.includes('"layout": "auto"') === true);
      await ready(s.page);
      const saved = await saveBundle(s.page);
      expect(saved.text).toBe(cliBundle(join(repo, 'examples/bpmn/order-handling.bpmn'), ['json.indent=4', 'verbalization.language=de', 'diagram.layout=auto']));
      expect(saved.text).not.toBe(golden('bpmn/order-handling.bpmn'));
    } finally {
      await s.context.close();
    }
  });

  it('PNML with changed options (mermaid direction, verbalization in German, structure report limit) equals the CLI', async () => {
    const s = await openApp(browser);
    try {
      await pickExample(s.page, 'producer-consumer.pnml');
      await s.page.selectOption('#rep-a', 'mermaid');
      await s.page.locator('#view-a .bar-buttons button').first().click();
      await s.page.locator('#view-a-opt-direction').selectOption('TB');
      await s.page.keyboard.press('Escape');
      await s.page.locator('#view-b .bar-buttons button').first().click();
      await s.page.locator('#view-b-opt-language').selectOption('de');
      await s.page.keyboard.press('Escape');
      await s.page.getByRole('tab', { name: 'Structure report' }).click();
      await s.page.locator('#structure-opt-maxStates').fill('2000');
      await s.page.waitForFunction(() => window.__reprWerkbank?.bundleJson?.includes('"maxStates": 2000') === true);
      const saved = await saveBundle(s.page);
      expect(saved.text).toBe(cliBundle(join(repo, 'examples/pnml/producer-consumer.pnml'), ['mermaid.direction=TB', 'verbalization.language=de', 'structure-report.maxStates=2000', 'structure-report-json.maxStates=2000']));
    } finally {
      await s.context.close();
    }
  });
});

describe('prompt block composer (FA-28, FA-71)', () => {
  it('composes by keyboard, shows a live preview, and copies and saves exactly the core prompt block', async () => {
    const s = await openApp(browser);
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(s.page.url()).origin });
    try {
      await s.page.getByRole('tab', { name: 'Export' }).click();
      const items = (): Promise<string[]> => s.page.locator('.composer-item').evaluateAll((li) => li.map((x) => x.getAttribute('data-step') ?? ''));
      expect(await items()).toEqual(['original', 'verbalization']);
      await s.page.waitForSelector('.preview');
      // Add the structure report, then move it up with the keyboard (Space on the focused button).
      await s.page.locator('#composer-add').selectOption('structure-report');
      await s.page.getByRole('button', { name: 'Add', exact: true }).click();
      expect(await items()).toEqual(['original', 'verbalization', 'structure-report']);
      await s.page.locator('[data-action="up"][data-index="2"]').focus();
      await s.page.keyboard.press('Space');
      expect(await items()).toEqual(['original', 'structure-report', 'verbalization']);
      // The focus stays on a button of the moved item, so repeated presses keep moving it.
      expect(await s.page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-action'))).toBe('up');
      await s.page.keyboard.press('Enter');
      expect(await items()).toEqual(['structure-report', 'original', 'verbalization']);
      await s.page.getByRole('button', { name: 'Remove Original file' }).click();
      expect(await items()).toEqual(['structure-report', 'verbalization']);

      const expectBlock = (header: boolean): string => {
        const text = readFileSync(join(repo, 'examples/bpmn/order-handling.bpmn'), 'utf8');
        return promptBlock(createDefaultRegistry(), parseModel(text), [{ generator: 'structure-report' }, { generator: 'verbalization' }], { header, inputName: 'order-handling.bpmn' }).text;
      };
      await s.page.waitForFunction((want) => document.querySelector('.preview')?.textContent === want, expectBlock(true));
      expect(await s.page.locator('.composer-figures').textContent()).toMatch(/characters · .* lines · .* tokens \(o200k_base\)/);

      // Copy.
      await s.page.getByRole('button', { name: 'Copy the block' }).click();
      await s.page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('# repr-werkbank'));
      expect(await s.page.evaluate(() => navigator.clipboard.readText())).toBe(expectBlock(true));
      // Save .txt.
      const saved = await downloadText(s.page, () => s.page.getByRole('button', { name: 'Save as .txt' }).click());
      expect(saved.name).toBe('order-handling.prompt.txt');
      expect(saved.text).toBe(expectBlock(true));

      // Header off: the preview is the bare combination.
      await s.page.locator('label[for="composer-header"]').click();
      await s.page.waitForFunction((want) => document.querySelector('.preview')?.textContent === want, expectBlock(false));
      expect(expectBlock(false).startsWith('#')).toBe(false);
      // The composition is remembered, the open tab is not.
      await s.page.reload();
      await modelLoaded(s.page, 'order-handling.bpmn');
      expect(await s.page.locator('.lower-panel').isHidden()).toBe(true);
      await s.page.getByRole('tab', { name: 'Export' }).click();
      expect(await items()).toEqual(['structure-report', 'verbalization']);
      expect(await s.page.locator('#composer-header').isChecked()).toBe(false);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
});
