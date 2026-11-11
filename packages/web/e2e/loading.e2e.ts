import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { largeBpmn, largePnml } from '../../core/test/large-models.ts';
import { bundleOf, foreignRequests, golden, launchBrowser, modelLoaded, openApp, ready, repo, tempFile } from './helpers.ts';

// M2 acceptance 5: an own BPMN file and an own PNML file can be loaded, and the network log shows no request to a foreign server.
let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

const bundleName = (bundle: string | null): string | null => (bundle === null ? null : (JSON.parse(bundle) as { metadata: { input: { name: string | null } } }).metadata.input.name);
const formalism = (bundle: string | null): string | null => (bundle === null ? null : (JSON.parse(bundle) as { metadata: { formalism: string } }).metadata.formalism);

describe('M2 acceptance 5: own files load, and no request leaves the page origin', () => {
  it('loads an own BPMN and an own PNML file through the file input', async () => {
    const s = await openApp(browser);
    const bpmn = tempFile('my-process.bpmn', largeBpmn(40));
    const pnml = tempFile('my-net.pnml', largePnml(40));
    try {
      await s.page.setInputFiles('#file-input', bpmn.path);
      await modelLoaded(s.page, 'my-process.bpmn');
      expect(formalism(await bundleOf(s.page))).toBe('bpmn');
      expect(bundleName(await bundleOf(s.page))).toBe('my-process.bpmn');
      expect(await s.page.locator('#view-a .line').count()).toBeGreaterThan(40);
      await s.page.setInputFiles('#file-input', pnml.path);
      await modelLoaded(s.page, 'my-net.pnml');
      expect(formalism(await bundleOf(s.page))).toBe('pnml');
      // The representations offered follow the formalism: the compact notation exists for PNML only, and the original has its extension.
      expect(await s.page.locator('#rep-a option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toContain('compact');
      expect(foreignRequests(s.requests)).toEqual([]);
      expect(s.errors).toEqual([]);
    } finally {
      bpmn.dispose();
      pnml.dispose();
      await s.context.close();
    }
  });

  it('loads a file dropped on the page', async () => {
    const s = await openApp(browser);
    try {
      const text = readFileSync(join(repo, 'examples/pnml/wf-sound.pnml'), 'utf8');
      await s.page.evaluate((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'dropped.pnml', { type: 'application/xml' }));
        for (const type of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, text);
      await modelLoaded(s.page, 'dropped.pnml');
      expect(bundleName(await bundleOf(s.page))).toBe('dropped.pnml');
      expect(formalism(await bundleOf(s.page))).toBe('pnml');
      expect(foreignRequests(s.requests)).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('loads pasted text (no input name) and an example through the examples list', async () => {
    const s = await openApp(browser);
    try {
      await s.page.getByRole('button', { name: 'Load' }).click();
      await s.page.locator('#paste-text').fill(largePnml(20));
      await s.page.getByRole('button', { name: 'Read text' }).click();
      await s.page.waitForFunction(() => document.querySelector('.model-name')?.textContent === 'pasted text');
      await ready(s.page);
      expect(bundleName(await bundleOf(s.page))).toBeNull();
      await s.page.getByRole('button', { name: 'Examples' }).click();
      await s.page.getByRole('button', { name: /producer-consumer\.pnml/ }).click();
      await modelLoaded(s.page, 'producer-consumer.pnml');
      expect(await bundleOf(s.page)).toBe(golden('pnml/producer-consumer.pnml'));
      expect(foreignRequests(s.requests)).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('shows an error for a broken file and keeps the previous model; shows a notice for unsupported elements', async () => {
    const s = await openApp(browser);
    try {
      await s.page.setInputFiles('#file-input', join(repo, 'packages/core/test/fixtures/not-wellformed.bpmn'));
      await s.page.waitForSelector('.message[role="alert"]');
      expect(await s.page.locator('.model-name').textContent()).toBe('order-handling.bpmn');
      expect(await s.page.locator('.message[role="alert"]').textContent()).toMatch(/Line \d+, column \d+/);
      await s.page.setInputFiles('#file-input', { name: 'latin1.bpmn', mimeType: 'application/xml', buffer: Buffer.from([0x3c, 0x61, 0xe4, 0xff]) });
      await s.page.getByText('not valid UTF-8').waitFor();
      await s.page.setInputFiles('#file-input', join(repo, 'packages/core/test/fixtures/unsupported-elements.bpmn'));
      await s.page.locator('.message[role="status"]').waitFor();
      await s.page.getByRole('button', { name: 'Show details' }).click();
      expect(await s.page.locator('.notice-list li').count()).toBeGreaterThan(0);
      expect(s.errors).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it('makes no request to another origin over a whole session with all tabs, pages and an export', async () => {
    const s = await openApp(browser);
    try {
      for (const tab of ['Overview', 'Inventory', 'Structure report', 'Export']) await s.page.getByRole('tab', { name: tab }).click();
      await s.page.selectOption('#rep-b', 'diagram');
      await s.page.getByRole('link', { name: 'About' }).click();
      await s.page.getByRole('link', { name: 'Formats' }).click();
      await s.page.waitForSelector('#format-diagram svg');
      await s.page.locator('#format-json summary').first().click();
      await s.page.getByRole('link', { name: 'Legal notice' }).click();
      expect(foreignRequests(s.requests)).toEqual([]);
      // Everything that was requested is the page, its scripts, styles, fonts, the worker, an example, the licence file.
      expect(s.requests.every((u) => u.startsWith('http://127.0.0.1') || u.startsWith('data:') || u.startsWith('blob:'))).toBe(true);
    } finally {
      await s.context.close();
    }
  });
});
