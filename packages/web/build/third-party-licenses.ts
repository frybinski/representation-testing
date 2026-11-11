/**
 * THIRD_PARTY_LICENSES.txt (plan 4.3): the licence texts of everything that is bundled into the web build, collected from the packages
 * installed in node_modules and from the files of the repository. Deterministic: sorted by name, no dates, no paths of this machine.
 *
 * The runtime dependencies are the dependencies of `packages/core` and, transitively, theirs (the web package has none of its own; vite
 * and the test tools are build-time only and are not part of the page). Fonts and example models are bundled as data.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  /** The text of the licence file; empty when the package ships none. */
  text: string;
  /** Said in the file when `text` was not taken from a file of the package. */
  note?: string;
}

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  author?: string | { name?: string };
  dependencies?: Record<string, string>;
}

const readJson = (path: string): PackageJson => JSON.parse(readFileSync(path, 'utf8')) as PackageJson;

/** Directory of the installed package `name` as seen from `from`: the nearest `node_modules` upwards. */
function resolvePackage(name: string, from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`Package ${name} is not installed (looked up from ${from})`);
  }
}

/** The directories of the runtime dependencies of `packageDir`, transitively, each once. */
export function runtimeDependencies(packageDir: string): string[] {
  const seen = new Map<string, string>();
  const visit = (dir: string): void => {
    for (const name of Object.keys(readJson(join(dir, 'package.json')).dependencies ?? {})) {
      const found = resolvePackage(name, dir);
      if (seen.has(found)) continue;
      seen.set(found, name);
      visit(found);
    }
  };
  visit(packageDir);
  return [...seen.keys()];
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\..*)?$/i;

function licenseText(dir: string): string {
  const file = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort()[0];
  return file ? readFileSync(join(dir, file), 'utf8').trim() : '';
}

/**
 * The standard ISC licence text (the licence `saxes` declares in its package.json; the package ships no licence file). The copyright
 * line is the package's `author` field.
 */
function iscText(holder: string): string {
  return [
    `Copyright (c) ${holder}`,
    '',
    'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  ].join('\n');
}

function fromPackage(dir: string): LicenseEntry {
  const pkg = readJson(join(dir, 'package.json'));
  const license = pkg.license ?? 'unknown';
  let text = licenseText(dir);
  let note: string | undefined;
  if (text === '') {
    const holder = typeof pkg.author === 'string' ? pkg.author.replace(/\s*<[^>]*>/, '') : pkg.author?.name;
    if (license === 'ISC' && holder) {
      text = iscText(holder);
      note = 'The package ships no licence file; this is the standard ISC text with the author named in its package.json.';
    } else {
      throw new Error(`${pkg.name}: no licence file and no rule to derive one`);
    }
  }
  return { name: pkg.name, version: pkg.version, license, text, ...(note !== undefined && { note }) };
}

/** Licence entries for the web build, sorted by name. `repo` is the repository root. */
export function collectLicenses(repo: string): LicenseEntry[] {
  const entries = runtimeDependencies(join(repo, 'packages/core')).map(fromPackage);
  const fonts = join(repo, 'packages/web/src/fonts');
  entries.push(
    { name: 'Inter (font)', version: '', license: 'OFL-1.1', text: readFileSync(join(fonts, 'OFL-Inter.txt'), 'utf8').trim() },
    { name: 'JetBrains Mono (font)', version: '', license: 'OFL-1.1', text: readFileSync(join(fonts, 'OFL-JetBrains-Mono.txt'), 'utf8').trim() },
    { name: 'Example models (examples/)', version: '', license: 'CC-BY-4.0', text: readFileSync(join(repo, 'examples/LICENSE'), 'utf8').trim() },
  );
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function renderLicenses(entries: readonly LicenseEntry[], toolVersion: string): string {
  const rule = '='.repeat(78);
  const parts = [
    `Third-party licences of repr-werkbank ${toolVersion}`,
    '',
    'repr-werkbank itself is MIT licensed (LICENSE in the repository). The components below are part of this page: code that is bundled into it,',
    'the fonts, and the example models. Generated at build time from the licence files of the packages and of the repository.',
    '',
  ];
  for (const e of entries) {
    parts.push(rule, `${e.name}${e.version ? ` ${e.version}` : ''}`, `License: ${e.license}`);
    if (e.note) parts.push(`Note: ${e.note}`);
    parts.push('', e.text, '');
  }
  return `${parts.join('\n')}\n`;
}

export const LICENSES_FILE = 'THIRD_PARTY_LICENSES.txt';

/** Emits the file into the build and serves it from the dev server. */
export function thirdPartyLicenses(repo: string, toolVersion: string): Plugin {
  const source = (): string => renderLicenses(collectLicenses(repo), toolVersion);
  return {
    name: 'third-party-licenses',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LICENSES_FILE, source: source() });
    },
    configureServer(server) {
      server.middlewares.use(`/${LICENSES_FILE}`, (_req, res) => {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(source());
      });
    },
  };
}
