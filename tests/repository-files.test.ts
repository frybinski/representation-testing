import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../packages/core/src/version.ts';
import { collectLicenses, renderLicenses, LICENSES_FILE } from '../packages/web/build/third-party-licenses.ts';

const root = new URL('../', import.meta.url).pathname;

describe('files of the repository that carry the version (FA-82)', () => {
  it('CITATION.cff has the version of the tool', () => {
    const cff = readFileSync(join(root, 'CITATION.cff'), 'utf8');
    expect(cff).toMatch(/^cff-version: 1\.2\.0$/m);
    expect(cff).toContain(`version: ${VERSION}`);
  });
});

describe('THIRD_PARTY_LICENSES.txt (plan 4.3)', () => {
  const entries = collectLicenses(root);

  it('covers exactly the runtime dependencies of the core, the fonts and the examples', () => {
    expect(entries.map((e) => e.name)).toEqual(['@dagrejs/dagre', '@dagrejs/graphlib', 'Example models (examples/)', 'Inter (font)', 'JetBrains Mono (font)', 'gpt-tokenizer', 'saxes', 'xmlchars']);
  });

  it('follows the dependencies declared in the lock file (a new runtime dependency fails here)', () => {
    const lock = (JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dependencies?: Record<string, string> }> }).packages;
    const seen = new Set<string>();
    const resolve = (from: string, name: string): string => {
      for (let base = from; ; ) {
        const key = `${base}${base === '' ? '' : '/'}node_modules/${name}`;
        if (lock[key]) return key;
        if (base === '') throw new Error(`${name} missing in the lock file`);
        const i = base.lastIndexOf('/node_modules/');
        base = i < 0 ? '' : base.slice(0, i);
      }
    };
    const visit = (key: string): void => {
      for (const dep of Object.keys(lock[key]?.dependencies ?? {})) {
        const found = resolve(key, dep);
        if (!seen.has(found)) {
          seen.add(found);
          visit(found);
        }
      }
    };
    visit('packages/core');
    expect([...seen].map((k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length)).sort()).toEqual(['@dagrejs/dagre', '@dagrejs/graphlib', 'gpt-tokenizer', 'saxes', 'xmlchars']);
  });

  it('has a licence text for every entry and renders the same bytes every time', () => {
    for (const e of entries) {
      expect(e.text.length, e.name).toBeGreaterThan(200);
      expect(e.license, e.name).not.toBe('unknown');
    }
    const a = renderLicenses(entries, VERSION);
    expect(renderLicenses(collectLicenses(root), VERSION)).toBe(a);
    expect(a).not.toMatch(/\/home\/|\/tmp\/|20\d\d-\d\d-\d\d/);
  });

  it('is in the web build and equals what the generator renders', () => {
    const built = join(root, 'packages/web/dist', LICENSES_FILE);
    expect(existsSync(built)).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(renderLicenses(entries, VERSION));
  });
});
