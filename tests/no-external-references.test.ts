import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Section 9 / R-2: the built state contains no reference to a foreign server and no code that opens a connection.
// URLs are allowed only as XML namespace or schema identifiers of the formats the tool reads and writes.
const root = new URL('../', import.meta.url).pathname;
const ALLOWED_HOSTS = ['www.omg.org', 'www.w3.org', 'www.pnml.org', 'example.invalid', 'json-schema.org'];
// Link targets (H76): addresses the person may follow with a click. They are separate from the namespace hosts above, they are exact
// addresses (no host is allowed as a whole), and they may occur only in the JavaScript of the web build, where `packages/web/src/links.ts`
// writes them and `externalLink` sets them as `href` (checked below on the sources). The network-API check is unchanged and applies to
// every file.
const LINK_TARGETS = new Set([
  'https://doi.org/10.1007/978-3-032-40377-3_3',
  'https://github.com/frybinski/representation-testing',
  'https://github.com/frybinski/representation-testing/blob/main/LICENSE',
  'https://github.com/frybinski/representation-testing/blob/main/CITATION.cff',
  'https://creativecommons.org/licenses/by/4.0/',
]);
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>)\\]+/gi;
const isWebScript = (file: string): boolean => file.startsWith(join(root, 'packages/web/dist/assets/')) && file.endsWith('.js');
const NETWORK_API = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:https?|node:net|node:dgram|from ['"]https?['"])/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(js|mjs|cjs|json|html|css)$/.test(name) && !name.endsWith('.tsbuildinfo') ? [path] : [];
  });
}

describe('no references to foreign servers (R-2)', () => {
  const built = readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'dist'));
  const present = built.filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  it('there is a built state to scan', () => {
    expect(present.length).toBeGreaterThanOrEqual(2);
  });

  for (const dir of present) {
    for (const file of files(dir)) {
      it(file.slice(root.length), () => {
        const text = readFileSync(file, 'utf8');
        const urls = [...text.matchAll(URL_IN_TEXT)].map((m) => m[0]);
        const foreign = urls.filter((u) => {
          const host = /^https?:\/\/([a-z0-9.-]+)/i.exec(u)?.[1]?.toLowerCase() ?? '';
          if (ALLOWED_HOSTS.includes(host)) return false;
          return !(LINK_TARGETS.has(u) && isWebScript(file));
        });
        expect(foreign).toEqual([]);
        expect(NETWORK_API.exec(text)?.[0]).toBeUndefined();
      });
    }
  }
});

describe('link targets are used as links only (H76)', () => {
  const src = join(root, 'packages/web/src');
  const sources = files2(src).filter((f) => f.endsWith('.ts'));

  it('every address in the web sources is in the allow-list and written in links.ts only', () => {
    for (const file of sources) {
      const urls = [...readFileSync(file, 'utf8').matchAll(URL_IN_TEXT)].map((m) => m[0]);
      for (const u of urls) {
        const host = /^https?:\/\/([a-z0-9.-]+)/i.exec(u)?.[1]?.toLowerCase() ?? '';
        if (ALLOWED_HOSTS.includes(host)) continue;
        expect(LINK_TARGETS.has(u), `${file}: ${u}`).toBe(true);
        expect(file.endsWith('links.ts'), `${u} outside links.ts: ${file}`).toBe(true);
      }
    }
  });

  it('the links reach the page only through externalLink, which sets an href', () => {
    for (const file of sources.filter((f) => !f.endsWith('links.ts'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (/\bLINKS\b/.test(line)) expect(line, `${file}: ${line}`).toMatch(/externalLink\(/);
      }
    }
    const links = readFileSync(join(src, 'links.ts'), 'utf8');
    expect(links).toMatch(/a\.href = LINKS\[name\]/);
    expect(links).not.toMatch(/fetch|XMLHttpRequest|location|window\.open/);
  });

  it('all allowed link targets are in the built page, so the list has no dead entries', () => {
    const built = files(join(root, 'packages/web/dist/assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const u of LINK_TARGETS) expect(built, u).toContain(u);
  });
});

function files2(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files2(path) : [path];
  });
}
