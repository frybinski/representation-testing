import { JSDOM } from 'jsdom';
import type MermaidApi from 'mermaid';

type Mermaid = typeof MermaidApi;
let mermaidPromise: Promise<Mermaid> | undefined;

/** Loads Mermaid under jsdom globals (Mermaid needs a DOM; the core itself does not). */
export function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= (async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'DOMParser', 'MutationObserver']) {
      if (g[k] === undefined) Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    }
    const m = (await import('mermaid')).default;
    m.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return m;
  })();
  return mermaidPromise;
}
