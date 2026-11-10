import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Section 9 / R-2: the built state contains no reference to a foreign server and no code that opens a connection.
// URLs are allowed only as XML namespace or schema identifiers of the formats the tool reads and writes.
const root = new URL('../', import.meta.url).pathname;
const ALLOWED_HOSTS = ['www.omg.org', 'www.w3.org', 'www.pnml.org', 'example.invalid'];
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
        const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => (m[1] ?? '').toLowerCase());
        expect(hosts.filter((h) => !ALLOWED_HOSTS.includes(h))).toEqual([]);
        expect(NETWORK_API.exec(text)?.[0]).toBeUndefined();
      });
    }
  }
});
