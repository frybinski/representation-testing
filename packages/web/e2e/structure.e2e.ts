import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { bundleOf, downloadText, launchBrowser, openApp, ready } from './helpers.ts';

// Soundness runs outside the main thread and can be cancelled (NF-02, plan 3.1).
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

describe('structure report', () => {
  it('shows the report of the loaded model and saves it as JSON', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('tab', { name: 'Structure report' }).click();
      await s.page.locator('.report').waitFor();
      expect(await s.page.locator('.report').textContent()).toMatch(/Structure report|nodes/i);
      const saved = await downloadText(s.page, () => s.page.getByRole('button', { name: 'Save as JSON' }).click());
      expect(saved.name).toBe('order-handling.structure-report-json.json');
      expect((JSON.parse(saved.text) as { format: string }).format).toBe('repr-werkbank/structure-report');
    } finally {
      await s.context.close();
    }
  });

  it('cancels a long soundness search on wf-large.pnml: worker ended, fresh worker, no bundle, views stay, a new run works', async () => {
    const s = await openApp(browser);
    try {
      const workers: { closed: boolean }[] = [];
      s.page.on('worker', (w) => {
        const entry = { closed: false };
        workers.push(entry);
        w.on('close', () => (entry.closed = true));
      });
      await s.page.getByRole('button', { name: 'Examples' }).click();
      await s.page.getByRole('button', { name: /wf-large\.pnml/ }).click();
      await s.page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'wf-large.pnml');
      await s.page.getByRole('tab', { name: 'Structure report' }).click();
      // The highest state limit makes the search run long enough to be cancelled.
      await s.page.locator('#structure-opt-maxStates').fill('500000');
      await s.page.getByText('The structure report is being computed').waitFor();
      const before = workers.length;
      // The page stays responsive while the search runs in the worker.
      expect(await s.page.evaluate(() => 1 + 1)).toBe(2);
      await s.page.getByRole('button', { name: 'Cancel' }).click();
      await s.page.getByText('The computation was cancelled').waitFor();
      expect(workers.length).toBe(before + 1);
      await s.page.waitForTimeout(300);
      expect(workers.some((w) => w.closed)).toBe(true);
      expect(await bundleOf(s.page)).toBeNull();
      expect(await s.page.locator('#view-a .line').count()).toBeGreaterThan(10);
      await s.page.getByRole('tab', { name: 'Export' }).click();
      expect(await s.page.locator('.export-bundle .push-button').isDisabled()).toBe(true);
      expect(await s.page.locator('.export-bundle').textContent()).toContain('cancelled');
      await s.page.getByRole('tab', { name: 'Structure report' }).click();
      await s.page.locator('#structure-opt-maxStates').fill('1000');
      await ready(s.page);
      expect(typeof (await bundleOf(s.page))).toBe('string');
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('computes the report again after a cancel with the Compute again button', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('button', { name: 'Examples' }).click();
      await s.page.getByRole('button', { name: /wf-large\.pnml/ }).click();
      await s.page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'wf-large.pnml');
      await s.page.getByRole('tab', { name: 'Structure report' }).click();
      await s.page.getByRole('button', { name: 'Cancel' }).click();
      await s.page.getByRole('button', { name: 'Compute again' }).click();
      await ready(s.page);
      expect(await s.page.locator('.report').textContent()).toMatch(/not decided/i);
    } finally {
      await s.context.close();
    }
  });
});
