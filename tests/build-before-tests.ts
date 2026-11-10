import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Packages import the core through its `dist/` output (H4) and the determinism test runs the built command line tool,
// so a fresh clone has nothing to test until the build has run. `npm test` therefore builds first; the output is shown on failure only.
export default function setup(): void {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`npm run build failed before the tests:\n${err.stdout ?? ''}${err.stderr ?? ''}`, { cause: e });
  }
}
