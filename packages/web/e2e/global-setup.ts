import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preview, type PreviewServer } from 'vite';

// Builds everything (the page imports the core through dist/, the CLI is run for the byte comparison) and serves the built page from a
// free port. The address reaches the tests through the environment (the test processes are started after this runs).
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const web = fileURLToPath(new URL('..', import.meta.url));

let server: PreviewServer | undefined;

export async function setup(): Promise<void> {
  try {
    execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`npm run build failed before the browser tests:\n${err.stdout ?? ''}${err.stderr ?? ''}`, { cause: e });
  }
  server = await preview({ root: web, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0 } });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The preview server has no address');
  process.env['E2E_BASE_URL'] = url;
}

export async function teardown(): Promise<void> {
  const s = server;
  if (s) await new Promise<void>((resolve) => s.httpServer.close(() => resolve()));
}
