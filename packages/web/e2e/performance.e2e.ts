import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { largeBpmn, largePnml } from '../../core/test/large-models.ts';
import { bundleOf, launchBrowser, modelLoaded, openApp, tempFile } from './helpers.ts';

// NF-02: a model of 500 nodes is processed without noticeable waiting, and the main thread is not blocked while it is. The long task API
// reports every stretch of the main thread longer than 50 ms; the budget for one stretch is 200 ms (H77). Numbers are printed.
const LONG_TASK_BUDGET_MS = 200;
const FIRST_RESULT_BUDGET_MS = 4000;

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

const OBSERVER = `
  window.__longTasks = [];
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
`;

describe('large models in the browser (NF-02)', () => {
  it.each([
    ['BPMN', 'large.bpmn', largeBpmn(500)],
    ['PNML', 'large.pnml', largePnml(500)],
  ])('keeps the main thread free while a 500-node %s model is processed and shown', async (kind, file, text) => {
    const s = await openApp(browser, { init: OBSERVER });
    const f = tempFile(file, text);
    try {
      await s.page.evaluate(() => {
        (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
      });
      const t0 = Date.now();
      await s.page.setInputFiles('#file-input', f.path);
      await s.page.waitForFunction(() => /^large\./.test(document.querySelector('.model-name')?.textContent ?? '') && window.__reprWerkbank?.firstMs !== null && window.__reprWerkbank?.firstMs !== undefined);
      const waited = Date.now() - t0;
      await modelLoaded(s.page, file);
      const times = await s.page.evaluate(() => ({ ...window.__reprWerkbank!, longTasks: (window as unknown as { __longTasks: number[] }).__longTasks }));
      // Show the diagram too: the SVG of 500 nodes is the heaviest thing the page itself makes.
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.waitForSelector('#view-b g[data-element]', { state: 'attached' });
      await s.page.waitForTimeout(500);
      await s.page.getByRole('tab', { name: 'Inventory' }).click();
      await s.page.getByRole('tab', { name: 'Export' }).click();
      await s.page.waitForSelector('.preview');
      const all = await s.page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
      // The first entries belong to processing and showing the two texts; what comes after belongs to the diagram, the inventory and the export tab.
      const longTasks = times.longTasks;
      const afterwards = all.slice(longTasks.length);
      const longest = Math.max(0, ...all);
      console.log(`${kind}: while loading ${JSON.stringify(longTasks.map(Math.round))} ms; diagram, inventory and export ${JSON.stringify(afterwards.map(Math.round))} ms`);
      console.log(`${kind}: first result ${String(Math.round(times.firstMs ?? -1))} ms (worker phase one ${String(Math.round(times.startMs ?? -1))} ms), complete ${String(Math.round(times.completeMs ?? -1))} ms, wait seen by the test ${String(waited)} ms, ${String(await s.page.locator('#view-a .line').count())} lines in view A, long tasks on the main thread: ${String(longTasks.length)}, longest ${String(Math.round(longest))} ms`);
      expect(times.firstMs ?? Infinity).toBeLessThan(FIRST_RESULT_BUDGET_MS);
      expect(longest).toBeLessThan(LONG_TASK_BUDGET_MS);
      expect(typeof (await bundleOf(s.page))).toBe('string');
      expect(s.errors).toEqual([]);
    } finally {
      f.dispose();
      await s.context.close();
    }
  });
});
