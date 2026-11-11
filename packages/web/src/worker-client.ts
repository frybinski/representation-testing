/**
 * The page's side of the worker (3.1). One worker serves one request at a time. A newer request supersedes the running one: while the
 * slow second phase runs the worker is terminated and replaced (that is also how the person cancels the structure report); during the
 * short first phase the worker itself drops the old request. Responses of superseded requests are ignored here.
 */
import type { CompleteResult, ErrorResult, PartialResult, RunRequest, WorkerResponse } from './protocol.ts';

export interface ClientHandlers {
  onPartial(result: PartialResult): void;
  onComplete(result: CompleteResult): void;
  onError(result: ErrorResult): void;
}

export type Phase = 'idle' | 'first' | 'additions';

export class WorkerClient {
  private worker: Worker;
  private current = 0;
  private phaseValue: Phase = 'idle';

  constructor(private readonly handlers: ClientHandlers) {
    this.worker = this.spawn();
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.receive(event.data));
    worker.addEventListener('error', (event) => {
      const id = this.current;
      this.phaseValue = 'idle';
      this.handlers.onError({ type: 'error', id, kind: 'internal', message: event.message || 'The worker stopped unexpectedly' });
    });
    return worker;
  }

  private receive(message: WorkerResponse): void {
    if (message.id !== this.current) return;
    if (message.type === 'partial') {
      this.phaseValue = message.pending.length > 0 ? 'additions' : 'idle';
      this.handlers.onPartial(message);
    } else if (message.type === 'complete') {
      this.phaseValue = 'idle';
      this.handlers.onComplete(message);
    } else {
      this.phaseValue = 'idle';
      this.handlers.onError(message);
    }
  }

  /** Starts a request and returns its id. A running request is superseded. */
  run(request: Omit<RunRequest, 'type' | 'id'>): number {
    if (this.phaseValue === 'additions') this.restart();
    this.current += 1;
    this.phaseValue = 'first';
    this.worker.postMessage({ type: 'run', id: this.current, ...request } satisfies RunRequest);
    return this.current;
  }

  /** Stops the running request: terminates the worker and starts a fresh one. Nothing is reported for the stopped request. */
  cancel(): void {
    this.current += 1;
    this.restart();
    this.phaseValue = 'idle';
  }

  private restart(): void {
    this.worker.terminate();
    this.worker = this.spawn();
  }

  dispose(): void {
    this.worker.terminate();
  }
}
