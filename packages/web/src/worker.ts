/**
 * The worker (NF-02): parsing, all generators, figures, inventory and the bundle run here, never on the page's thread. The soundness
 * search of the structure report is the slow part; it starts after the first result has been sent. The page cancels it by terminating
 * the worker (worker-client.ts), so nothing in here has to be interruptible.
 */
import { createDefaultRegistry, loadDefaultTokenizer, runAdditions, type Tokenizer } from '@repr-werkbank/core';
import { completeOf, errorOf, partialOf, startRequest } from './pipeline.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const registry = createDefaultRegistry();
let tokenizer: Promise<Tokenizer> | null = null;
/** Id of the newest request seen; an older request stops before its slow phase. */
let latest = 0;

const post = (message: WorkerResponse): void => self.postMessage(message);

async function handle(req: WorkerRequest): Promise<void> {
  try {
    tokenizer ??= loadDefaultTokenizer();
    const tok = await tokenizer;
    if (latest !== req.id) return;
    const t0 = performance.now();
    const stage = startRequest(req, tok, registry);
    post(partialOf(req.id, stage, performance.now() - t0));
    // Let a newer request that is already queued be read before the slow phase starts.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (latest !== req.id) return;
    const t1 = performance.now();
    const outputs = runAdditions(stage);
    post(completeOf(req.id, stage, performance.now() - t1, outputs));
  } catch (e) {
    post(errorOf(req.id, e));
  }
}

self.addEventListener('message', (event) => {
  const req = event.data as WorkerRequest;
  latest = req.id;
  void handle(req);
});
