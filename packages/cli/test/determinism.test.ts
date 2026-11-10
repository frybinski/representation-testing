import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Acceptance point 4: two runs of the command line tool on the same inputs give identical files (compared by SHA-256),
// also from another working directory and under another locale and time zone. The built tool is run as a separate process.
const root = new URL('../../../', import.meta.url).pathname;
const bin = join(root, 'packages/cli/dist/bin.js');
const examples = join(root, 'examples');
const work = mkdtempSync(join(tmpdir(), 'repr-determinism-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function hashes(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(path).isDirectory()) Object.assign(out, hashes(path, rel));
    else out[rel] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return out;
}

function runCli(out: string, cwd: string, env: Record<string, string>): string {
  const r = spawnSync(process.execPath, [bin, examples, '--out', out], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  return r.stdout;
}

describe('command line determinism (acceptance point 4)', () => {
  const first = join(work, 'run1');
  const second = join(work, 'run2');
  const other = join(work, 'run3');
  const elsewhere = mkdtempSync(join(work, 'cwd-'));
  const outputs: string[] = [];

  it('two runs write the same files', () => {
    outputs.push(runCli(first, root, {}), runCli(second, root, {}));
    const a = hashes(first);
    expect(Object.keys(a)).toHaveLength(7);
    expect(hashes(second)).toEqual(a);
    expect(outputs[1]).toBe(outputs[0]);
  });

  it('another working directory, locale and time zone change nothing', () => {
    outputs.push(runCli(other, elsewhere, { LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Kiritimati' }));
    expect(hashes(other)).toEqual(hashes(first));
    expect(outputs[2]).toBe(outputs[0]);
  });

  it('the bundles equal the recorded golden bundles', () => {
    const produced = hashes(first);
    for (const [rel, hash] of Object.entries(produced)) {
      const golden = join(root, 'tests/golden', rel.replace(/\.bundle\.json$/, ''), 'bundle.json');
      expect(createHash('sha256').update(readFileSync(golden)).digest('hex'), rel).toBe(hash);
    }
  });
});
